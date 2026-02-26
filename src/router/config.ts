import type { RoutingConfig } from "./types.js";

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  version: "3.0",
  aiRouting: {
    model: "google/gemini-2.5-flash",
    maxTokens: 20,
    temperature: 0,
    cacheTtlMs: 300_000,
    promptTruncationChars: 8000,
  },
};
