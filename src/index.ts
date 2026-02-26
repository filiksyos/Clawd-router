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

  startProxy({ port: getProxyPort() || 8403 })
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
  getFallbackChain,
  getFallbackChainFiltered,
  calculateModelCost,
} from "./router/index.js";
export type { RoutingDecision, RoutingConfig, Tier } from "./router/index.js";
