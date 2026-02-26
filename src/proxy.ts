/**
 * Clawd-router HTTP Proxy
 *
 * Provides HTTP server with routing pipeline, OpenRouter forwarding,
 * fallback chain, streaming, and API key validation.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ModelPricing } from "./router/selector.js";
import { route, RoutingError, DEFAULT_ROUTING_CONFIG } from "./router/index.js";
import {
  OPENCLAW_MODELS,
  OPENROUTER_MODELS,
  resolveModelAlias,
} from "./models.js";
import { VERSION } from "./version.js";
import { fetchWithRetry } from "./retry.js";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export type ProxyOptions = {
  port?: number;
  host?: string;
  openRouterApiKey?: string;
};

export type ProxyHandle = {
  close: () => Promise<void>;
};

let activePort: number = 0;

/**
 * Get the port the proxy is listening on.
 * Returns 0 if the proxy has not been started.
 */
export function getProxyPort(): number {
  return activePort;
}

/**
 * Build model pricing map from OpenRouter models.
 */
function buildModelPricing(): Map<string, ModelPricing> {
  const map = new Map<string, ModelPricing>();
  for (const m of OPENROUTER_MODELS) {
    map.set(m.id, {
      inputPrice: m.inputPrice,
      outputPrice: m.outputPrice,
    });
  }
  return map;
}

const modelPricing = buildModelPricing();

/**
 * Read JSON body from request.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf-8");
  if (!body.trim()) return {};
  return JSON.parse(body) as unknown;
}

/**
 * Forward a chat completions request to OpenRouter with a specific model.
 */
async function forwardToOpenRouter(
  body: Record<string, unknown>,
  model: string,
  apiKey: string,
  stream: boolean,
): Promise<Response> {
  const url = `${OPENROUTER_BASE}/chat/completions`;
  const payload = { ...body, model };
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": `clawd-router/${VERSION}`,
  };

  const res = await fetchWithRetry(
    fetch,
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      duplex: "half",
    } as RequestInit,
  );

  return res;
}

/**
 * Choose target model: use routing for "auto"/"router", otherwise resolve alias.
 */
async function selectTargetModel(
  requestedModel: string,
  messages: unknown[],
  maxOutputTokens: number,
  apiKey: string,
): Promise<{ model: string }> {
  const resolved = resolveModelAlias(requestedModel).toLowerCase();

  if (resolved === "auto" || resolved === "router") {
    const decision = await route(
      messages,
      apiKey,
      DEFAULT_ROUTING_CONFIG,
      modelPricing,
      maxOutputTokens,
    );
    return { model: decision.model };
  }

  return { model: resolveModelAlias(requestedModel) };
}

/**
 * Handle POST /v1/chat/completions with routing, fallback, and streaming.
 */
async function handleChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  apiKey: string,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = (await readJsonBody(req)) as Record<string, unknown>;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Invalid JSON body", type: "invalid_request" } }));
    return;
  }

  const messages = (body.messages ?? []) as unknown[];
  if (!Array.isArray(messages) || messages.length === 0) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: { message: "messages is required and must be a non-empty array", type: "invalid_request" },
      }),
    );
    return;
  }

  const requestedModel = String(body.model ?? "auto").trim() || "auto";
  const maxOutputTokens = Number(body.max_tokens ?? 4096) || 4096;
  const stream = Boolean(body.stream);

  let primaryModel: string;
  try {
    const result = await selectTargetModel(
      requestedModel,
      messages,
      maxOutputTokens,
      apiKey,
    );
    primaryModel = result.model;
  } catch (err) {
    if (err instanceof RoutingError) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: err.message, type: "routing_error" },
        }),
      );
      return;
    }
    throw err;
  }

  try {
    const response = await forwardToOpenRouter(body, primaryModel, apiKey, stream);

    if (!response.ok) {
      const text = await response.text();
      let errBody: unknown;
      try {
        errBody = JSON.parse(text);
      } catch {
        errBody = { error: { message: text } };
      }
      res.writeHead(response.status, { "Content-Type": "application/json" });
      res.end(text || JSON.stringify(errBody));
      return;
    }

    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (stream && response.body) {
      const nodeStream = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
      nodeStream.pipe(res);
    } else {
      const text = await response.text();
      res.end(text);
    }
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: {
          message: err instanceof Error ? err.message : String(err),
          type: "internal_error",
        },
      }),
    );
  }
}

/**
 * Handle GET /v1/models - return OpenAI-format model list.
 */
function handleModels(res: ServerResponse): void {
  const data = {
    object: "list",
    data: OPENCLAW_MODELS.map((m) => ({
      id: m.id,
      object: "model",
      created: Date.now(),
      owned_by: "clawd-router",
    })),
  };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/**
 * Handle GET /health - simple health check.
 */
function handleHealth(res: ServerResponse): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", version: VERSION }));
}

/**
 * Start the HTTP proxy server.
 *
 * @param options - Proxy configuration (port, host, openRouterApiKey)
 * @returns Promise resolving to a ProxyHandle with close() method
 */
export function startProxy(options: ProxyOptions = {}): Promise<ProxyHandle> {
  return new Promise((resolve, reject) => {
    const port = options.port ?? 0;
    const host = options.host ?? "127.0.0.1";
    const apiKey =
      options.openRouterApiKey ?? process.env.OPENROUTER_API_KEY ?? "";

    const server = createServer(async (req, res) => {
      const url = req.url ?? "/";
      const method = req.method ?? "GET";
      const pathname = url.split("?")[0];

      if (method === "GET" && pathname === "/health") {
        handleHealth(res);
        return;
      }

      if (method === "GET" && pathname === "/v1/models") {
        handleModels(res);
        return;
      }

      if (method === "POST" && pathname === "/v1/chat/completions") {
        if (!apiKey.trim()) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: {
                message: "OpenRouter API key required. Set OPENROUTER_API_KEY or openRouterApiKey in options.",
                type: "authentication_error",
              },
            }),
          );
          return;
        }
        await handleChatCompletions(req, res, apiKey);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Not found", type: "invalid_request" } }));
    });

    server.on("error", reject);

    server.listen(port, host, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        activePort = addr.port;
      }
      resolve({
        close: () =>
          new Promise<void>((closeResolve) => {
            activePort = 0;
            server.close(() => closeResolve());
          }),
      });
    });
  });
}
