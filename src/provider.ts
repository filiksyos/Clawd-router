/**
 * Clawd Router Provider Plugin
 *
 * Registers the clawd-router provider for OpenClaw.
 * Models baseUrl is derived from activeProxyPort.
 */

import type { ProviderPlugin } from "./types.js";
import { buildProviderModels } from "./models.js";

let activeProxyPort: number = 8403;

export function setActiveProxyPort(port: number): void {
  activeProxyPort = port;
}

export const clawdRouterProvider: ProviderPlugin = {
  id: "clawd-router",
  label: "clawd Router",
  docsPath: "https://openrouter.ai",
  aliases: ["cr"],
  envVars: ["OPENROUTER_API_KEY"],
  auth: [],
  get models() {
    return buildProviderModels(`http://127.0.0.1:${activeProxyPort}`);
  },
};
