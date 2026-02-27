/**
 * Clawd-router HTTP Proxy
 *
 * Provides HTTP server with routing pipeline, OpenRouter forwarding,
 * fallback chain, streaming, and API key validation.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ModelPricing } from "./router/selector.js";
import { route, getFallbackChainFiltered, DEFAULT_ROUTING_CONFIG } from "./router/index.js";
import type { RoutingConfig, RoutingDecision } from "./router/index.js";
import {
  OPENCLAW_MODELS,
  OPENROUTER_MODELS,
  resolveModelAlias,
  getModelContextWindow,
} from "./models.js";
import { VERSION } from "./version.js";
import { fetchWithRetry } from "./retry.js";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export type ProxyOptions = {
  port?: number;
  host?: string;
  openRouterApiKey?: string;
  routingConfig?: Partial<RoutingConfig>;
  onReady?: (port: number) => void;
  onError?: (error: Error) => void;
  onRouted?: (decision: RoutingDecision) => void;
};

export type ProxyHandle = {
  close(): Promise<void>;
  baseUrl: string;
  port: number;
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
 * Extract prompt and system prompt from messages.
 * System: concatenate all system messages (forward iteration).
 * User prompt: use only the last user message (backward iteration).
 */
function extractPrompts(messages: unknown[]): { prompt: string; systemPrompt?: string } {
  let systemPrompt: string | undefined;

  for (const msg of messages) {
    const m = msg as { role?: string; content?: unknown };
    const role = (m?.role ?? "").toLowerCase();
    const content = extractContent(m?.content);

    if (role === "system") {
      systemPrompt = (systemPrompt ? `${systemPrompt}\n${content}` : content).trim() || undefined;
    }
  }

  let prompt = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; content?: unknown };
    const role = (m?.role ?? "").toLowerCase();
    if (role === "user") {
      prompt = extractContent(m?.content).trim() || "";
      break;
    }
  }

  return { prompt, systemPrompt };
}

function extractContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content) && content.length > 0) {
    const part = content[0] as { type?: string; text?: string } | unknown;
    if (part && typeof part === "object" && "type" in part && (part as { type?: string }).type === "text") {
      return String((part as { text?: string }).text ?? "");
    }
    return String(part);
  }
  return "";
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
    "X-Title": "clawd Router",
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
 * Handle POST /v1/chat/completions with routing, fallback, and streaming.
 */
async function handleChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  apiKey: string,
  onRouted?: (decision: RoutingDecision) => void,
  effectiveConfig: RoutingConfig = DEFAULT_ROUTING_CONFIG,
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

  const { prompt, systemPrompt } = extractPrompts(messages);

  const resolved = resolveModelAlias(requestedModel).toLowerCase();
  let routingProfile: "auto" | "eco" | undefined;
  if (resolved === "auto" || resolved === "router") {
    routingProfile = "auto";
  } else if (resolved === "eco") {
    routingProfile = "eco";
  } else {
    routingProfile = undefined;
  }

  let modelsToTry: string[];

  if (routingProfile === "auto" || routingProfile === "eco") {
    const decision = route(prompt, systemPrompt, maxOutputTokens, {
      config: effectiveConfig,
      modelPricing,
      routingProfile,
    });
    console.log(`[${decision.tier}|${routingProfile.toUpperCase()}] ${decision.model} | ${decision.reasoning}`);
    onRouted?.(decision);

    const tierConfigs =
      routingProfile === "eco"
        ? (effectiveConfig.ecoTiers ?? effectiveConfig.tiers)
        : effectiveConfig.tiers;
    const fullText = `${systemPrompt ?? ""} ${prompt}`;
    const estimatedInputTokens = Math.ceil(fullText.length / 4);
    const estimatedTotalTokens = estimatedInputTokens + maxOutputTokens;
    const fallbackChain = getFallbackChainFiltered(
      decision.tier,
      tierConfigs,
      estimatedTotalTokens,
      getModelContextWindow,
    );
    modelsToTry = fallbackChain.includes(decision.model)
      ? fallbackChain
      : [decision.model, ...fallbackChain];
  } else {
    const primaryModel = resolveModelAlias(requestedModel);
    modelsToTry = [primaryModel];
  }

  let lastError: Error | null = null;
  let lastStatus = 500;

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    if (i > 0) {
      console.log(`[fallback] ${model} (previous model failed)`);
    }
    try {
      const response = await forwardToOpenRouter(body, model, apiKey, stream);

      if (!response.ok) {
        lastStatus = response.status;
        const text = await response.text();
        let errBody: unknown;
        try {
          errBody = JSON.parse(text);
        } catch {
          errBody = { error: { message: text } };
        }
        lastError = new Error(
          `OpenRouter error (${response.status}): ${(errBody as { error?: { message?: string } })?.error?.message ?? text}`,
        );
        const retryable = [429, 502, 503, 504].includes(response.status);
        if (!retryable) {
          res.writeHead(response.status, { "Content-Type": "application/json" });
          res.end(text || JSON.stringify(errBody));
          return;
        }
        continue;
      }

      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      if (stream && response.body) {
        const nodeStream = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
        nodeStream.pipe(res);
      } else {
        const text = await response.text();
        res.end(text);
      }
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  res.writeHead(lastStatus, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      error: {
        message: lastError?.message ?? "All fallback models failed",
        type: "internal_error",
      },
    }),
  );
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

    const effectiveConfig: RoutingConfig = { ...DEFAULT_ROUTING_CONFIG, ...options.routingConfig };

    const server = createServer(async (req, res) => {
      /** API key precedence: `process.env.OPENROUTER_API_KEY` (per-request, primary) or fallback to `options.openRouterApiKey` (startup/plugin config). Trimmed. */
      const apiKey = (process.env.OPENROUTER_API_KEY ?? options.openRouterApiKey ?? "").trim();

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
        if (!apiKey) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: {
                message: "OpenRouter API key required. Set OPENROUTER_API_KEY.",
                type: "invalid_request",
              },
            }),
          );
          return;
        }
        await handleChatCompletions(req, res, apiKey, options.onRouted, effectiveConfig);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Not found", type: "invalid_request" } }));
    });

    server.on("error", (err) => {
      options.onError?.(err);
      reject(err);
    });

    server.listen(port, host, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        activePort = addr.port;
      }
      options.onReady?.(activePort);
      resolve({
        close: () =>
          new Promise<void>((closeResolve) => {
            activePort = 0;
            server.close(() => closeResolve());
          }),
        baseUrl: `http://${host}:${activePort}`,
        port: activePort,
      });
    });
  });
}
