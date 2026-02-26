/**
 * Clawd Router OpenClaw Plugin
 *
 * Registers the clawd-router provider, injects config into openclaw.json,
 * and starts the proxy in gateway mode.
 */

import type { OpenClawPluginDefinition, OpenClawPluginApi } from "./types.js";
import { clawdRouterProvider, setActiveProxyPort } from "./provider.js";
import { startProxy, getProxyPort } from "./proxy.js";
import { OPENCLAW_MODELS } from "./models.js";
import { readTextFileSync } from "./fs-read.js";
import { VERSION } from "./version.js";
import {
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  renameSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function isCompletionMode(): boolean {
  return process.argv.some((arg, i) => arg === "completion" && i >= 1 && i <= 3);
}

function isGatewayMode(): boolean {
  return process.argv.includes("gateway");
}

/** Resolve OpenRouter API key from OpenClaw config or auth-profiles (reuse key if already configured). */
function resolveOpenRouterApiKey(): string {
  const fromEnv = process.env.OPENROUTER_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  const stateDir =
    process.env.OPENCLAW_STATE_DIR ?? join(homedir(), ".openclaw");
  const configPath =
    process.env.OPENCLAW_CONFIG_PATH ?? join(stateDir, "openclaw.json");

  if (existsSync(configPath)) {
    try {
      const content = readTextFileSync(configPath).trim();
      if (content) {
        const config = JSON.parse(content) as Record<string, unknown>;

        // config.env.OPENROUTER_API_KEY (common in OpenClaw)
        const env = config.env as Record<string, unknown> | undefined;
        if (env) {
          const key = env.OPENROUTER_API_KEY;
          if (typeof key === "string" && key.trim()) return key.trim();
          const vars = env.vars as Record<string, unknown> | undefined;
          const vKey = vars?.OPENROUTER_API_KEY;
          if (typeof vKey === "string") {
            const v = vKey.trim();
            if (v) return v;
          }
        }

        // config.credentials.openrouter.apiKey (alternative layout)
        const creds = config.credentials as
          | Record<string, Record<string, unknown>>
          | undefined;
        if (creds?.openrouter?.apiKey && typeof creds.openrouter.apiKey === "string") {
          const k = creds.openrouter.apiKey.trim();
          if (k) return k;
        }

        // config.models.providers.openrouter.apiKey (if raw key stored)
        const providers = (config.models as Record<string, unknown>)?.["providers"] as
          | Record<string, Record<string, unknown>>
          | undefined;
        const openrouter = providers?.["openrouter"];
        if (openrouter?.apiKey && typeof openrouter.apiKey === "string") {
          const k = openrouter.apiKey.trim();
          if (k && (k.startsWith("sk-or-") || k.length > 20)) return k;
        }
      }
    } catch {
      /* ignore */
    }
  }

  // auth-profiles.json (when user ran: openclaw onboard --token-provider openrouter)
  const agentIds = ["main", "default"];
  for (const agentId of agentIds) {
    const authPath = join(stateDir, "agents", agentId, "agent", "auth-profiles.json");
    if (!existsSync(authPath)) continue;
    try {
      const content = readTextFileSync(authPath).trim();
      if (!content) continue;
      const store = JSON.parse(content) as {
        version?: number;
        profiles?: Record<string, { type?: string; provider?: string; key?: string }>;
      };
      const profiles = store?.profiles ?? {};
      for (const entry of Object.values(profiles)) {
        if (entry?.provider === "openrouter" && entry?.key?.trim()) {
          return entry.key.trim();
        }
      }
    } catch {
      /* ignore */
    }
  }

  return "";
}

function injectModelsConfig(logger: { info: (msg: string) => void }): void {
  const configDir = join(homedir(), ".openclaw");
  const configPath = join(configDir, "openclaw.json");

  if (!existsSync(configDir)) {
    try {
      mkdirSync(configDir, { recursive: true });
    } catch (err) {
      logger.info(`[clawd-router] Failed to create config dir: ${(err as Error).message}`);
      return;
    }
  }

  let config: Record<string, unknown> = {};
  let needsWrite = false;

  if (existsSync(configPath)) {
    try {
      const content = readTextFileSync(configPath).trim();
      if (content === "") {
        needsWrite = true;
      } else {
        config = JSON.parse(content) as Record<string, unknown>;
      }
    } catch {
      const backupPath = `${configPath}.backup.${Date.now()}`;
      copyFileSync(configPath, backupPath);
      logger.info(`[clawd-router] Invalid JSON in openclaw.json, backed up to ${backupPath}`);
      return;
    }
  } else {
    needsWrite = true;
  }

  if (!config.models) {
    config.models = {};
    needsWrite = true;
  }
  const models = config.models as Record<string, unknown>;
  if (!models.providers) {
    models.providers = {};
    needsWrite = true;
  }
  const providers = models.providers as Record<string, Record<string, unknown>>;

  const expectedBaseUrl = "http://127.0.0.1:8403/v1";
  const expectedApi = "openai-completions";
  const expectedApiKey = "openrouter-proxy";

  if (!providers["clawd-router"]) {
    providers["clawd-router"] = {
      baseUrl: expectedBaseUrl,
      api: expectedApi,
      apiKey: expectedApiKey,
      models: OPENCLAW_MODELS,
    };
    needsWrite = true;
  } else {
    const entry = providers["clawd-router"];
    let changed = false;
    if (entry.baseUrl !== expectedBaseUrl) {
      entry.baseUrl = expectedBaseUrl;
      changed = true;
    }
    if (entry.api !== expectedApi) {
      entry.api = expectedApi;
      changed = true;
    }
    if (entry.apiKey !== expectedApiKey) {
      entry.apiKey = expectedApiKey;
      changed = true;
    }
    const existingIds = new Set(
      Array.isArray(entry.models)
        ? (entry.models as { id: string }[]).map((m) => m.id)
        : [],
    );
    const expectedIds = new Set(OPENCLAW_MODELS.map((m) => m.id));
    if (
      existingIds.size !== expectedIds.size ||
      [...expectedIds].some((id) => !existingIds.has(id))
    ) {
      entry.models = OPENCLAW_MODELS;
      changed = true;
    }
    if (changed) needsWrite = true;
  }

  if (!config.agents) {
    config.agents = {};
    needsWrite = true;
  }
  const agents = config.agents as Record<string, unknown>;
  if (!agents.defaults) {
    agents.defaults = {};
    needsWrite = true;
  }
  const defaults = agents.defaults as Record<string, unknown>;
  if (!defaults.model) {
    defaults.model = {};
    needsWrite = true;
  }
  const modelDefaults = defaults.model as Record<string, unknown>;
  if (!modelDefaults.primary) {
    modelDefaults.primary = "clawd-router/auto";
    logger.info("[clawd-router] Set default model to clawd-router/auto (first install)");
    needsWrite = true;
  }

  // Add clawd-router to agents.defaults.models allowlist (required for models list / picker)
  if (!defaults.models || typeof defaults.models !== "object") {
    defaults.models = {};
    needsWrite = true;
  }
  const modelsAllowlist = defaults.models as Record<string, { alias?: string }>;
  const clawdRouterEntries: Record<string, { alias: string }> = {
    "clawd-router/auto": { alias: "auto" },
    "clawd-router/sonnet": { alias: "sonnet" },
    "clawd-router/opus": { alias: "opus" },
    "clawd-router/haiku": { alias: "haiku" },
    "clawd-router/gemini": { alias: "gemini" },
    "clawd-router/flash": { alias: "flash" },
    "clawd-router/gpt": { alias: "gpt" },
    "clawd-router/mini": { alias: "mini" },
    "clawd-router/deepseek": { alias: "deepseek" },
    "clawd-router/r1": { alias: "r1" },
  };
  for (const [modelId, entry] of Object.entries(clawdRouterEntries)) {
    if (!modelsAllowlist[modelId] || modelsAllowlist[modelId].alias !== entry.alias) {
      modelsAllowlist[modelId] = entry;
      needsWrite = true;
    }
  }

  if (needsWrite) {
    const tmpPath = `${configPath}.tmp.${process.pid}`;
    try {
      writeFileSync(tmpPath, JSON.stringify(config, null, 2));
      renameSync(tmpPath, configPath);
    } catch (err) {
      logger.info(`[clawd-router] Failed to write config: ${(err as Error).message}`);
    }
  }
}

let activeProxyHandle: Awaited<ReturnType<typeof startProxy>> | null = null;

async function register(api: OpenClawPluginApi): Promise<void> {
  if (
    process.env.CLAWD_ROUTER_DISABLED === "true" ||
    process.env.CLAWD_ROUTER_DISABLED === "1"
  ) {
    api.logger.info("[clawd-router] disabled (CLAWD_ROUTER_DISABLED=true)");
    return;
  }

  if (isCompletionMode()) {
    api.registerProvider(clawdRouterProvider);
    return;
  }

  api.registerProvider(clawdRouterProvider);
  injectModelsConfig(api.logger);
  api.registerService({
    id: "clawd-router-proxy",
    start: () => {},
    stop: async () => {
      if (activeProxyHandle) {
        await activeProxyHandle.close();
        activeProxyHandle = null;
      }
    },
  });

  if (!isGatewayMode()) {
    api.logger.info("[clawd-router] Not in gateway mode — proxy will start when gateway runs");
    return;
  }

  const apiKey = resolveOpenRouterApiKey();
  if (!apiKey) {
    api.logger.info(
      "[clawd-router] No OpenRouter key found. Set OPENROUTER_API_KEY or add it to openclaw.json env.OPENROUTER_API_KEY",
    );
  }
  startProxy({
    port: getProxyPort() || 8403,
    openRouterApiKey: apiKey || undefined,
  })
    .then((handle) => {
      activeProxyHandle = handle;
      setActiveProxyPort(getProxyPort());
      api.logger.info(`[clawd-router] Proxy listening on http://127.0.0.1:${getProxyPort()}`);
    })
    .catch((err) =>
      api.logger.error(`[clawd-router] Failed to start proxy: ${(err as Error).message}`),
    );

  api.logger.info("[clawd-router] Smart routing enabled → clawd-router/auto");
}

const plugin: OpenClawPluginDefinition = {
  id: "clawd-router",
  name: "clawd Router",
  version: VERSION,
  register,
};
export default plugin;

export { startProxy, getProxyPort } from "./proxy.js";
export type { ProxyOptions, ProxyHandle } from "./proxy.js";
export { clawdRouterProvider } from "./provider.js";
export {
  OPENCLAW_MODELS,
  OPENROUTER_MODELS,
  buildProviderModels,
  MODEL_ALIASES,
  resolveModelAlias,
  getModelContextWindow,
} from "./models.js";
export {
  route,
  DEFAULT_ROUTING_CONFIG,
  calculateModelCost,
} from "./router/index.js";
export type { RoutingDecision, RoutingConfig } from "./router/index.js";
