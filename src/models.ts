/**
 * OpenRouter Model Definitions for OpenClaw
 *
 * Maps 12 OpenRouter models to OpenClaw's ModelDefinitionConfig format.
 * All models use the "openai-completions" API since OpenRouter is OpenAI-compatible.
 *
 * Pricing is in USD per 1M tokens.
 */

import type { ModelDefinitionConfig, ModelProviderConfig } from "./types.js";

type OpenRouterModel = {
  id: string;
  name: string;
  version?: string;
  inputPrice: number;
  outputPrice: number;
  contextWindow: number;
  maxOutput: number;
  reasoning?: boolean;
  vision?: boolean;
};

export const MODEL_ALIASES: Record<string, string> = {
  claude: "anthropic/claude-sonnet-4-6",
  sonnet: "anthropic/claude-sonnet-4-6",
  opus: "anthropic/claude-opus-4-6",
  gemini: "google/gemini-2.5-pro",
  flash: "google/gemini-2.5-flash",
  gpt: "openai/gpt-5.2",
  mini: "openai/gpt-5-mini",
  deepseek: "deepseek/deepseek-v3.2",
  r1: "deepseek/deepseek-r1",
  kimi: "moonshotai/kimi-k2.5",
  minimax: "minimax/minimax-m2.5",
  "auto-router": "auto",
  router: "auto",
};

/**
 * Resolve a model alias to its full model ID.
 * Also strips "clawd-router/" prefix for direct model paths.
 */
export function resolveModelAlias(model: string): string {
  const normalized = model.trim().toLowerCase();
  const resolved = MODEL_ALIASES[normalized];
  if (resolved) return resolved;

  if (normalized.startsWith("clawd-router/")) {
    const withoutPrefix = normalized.slice("clawd-router/".length);
    const resolvedWithoutPrefix = MODEL_ALIASES[withoutPrefix];
    if (resolvedWithoutPrefix) return resolvedWithoutPrefix;
    return withoutPrefix;
  }

  return model;
}

export const OPENROUTER_MODELS: OpenRouterModel[] = [
  {
    id: "auto",
    name: "Auto (Smart Router - Balanced)",
    inputPrice: 0,
    outputPrice: 0,
    contextWindow: 1_050_000,
    maxOutput: 128_000,
  },
  // Google Gemini
  {
    id: "google/gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    version: "2.5",
    inputPrice: 0.1,
    outputPrice: 0.4,
    contextWindow: 1_048_576,
    maxOutput: 65_535,
  },
  {
    id: "google/gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    version: "2.5",
    inputPrice: 0.3,
    outputPrice: 2.5,
    contextWindow: 1_048_576,
    maxOutput: 65_535,
  },
  {
    id: "google/gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    version: "2.5",
    inputPrice: 1.25,
    outputPrice: 10.0,
    contextWindow: 1_048_576,
    maxOutput: 65_536,
    reasoning: true,
    vision: true,
  },
  // Anthropic Claude
  {
    id: "anthropic/claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    version: "4.6",
    inputPrice: 3.0,
    outputPrice: 15.0,
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    reasoning: true,
  },
  {
    id: "anthropic/claude-opus-4-6",
    name: "Claude Opus 4.6",
    version: "4.6",
    inputPrice: 5.0,
    outputPrice: 25.0,
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    reasoning: true,
  },
  // OpenAI (current)
  {
    id: "openai/gpt-5.2",
    name: "GPT-5.2",
    version: "5.2",
    inputPrice: 1.75,
    outputPrice: 14.0,
    contextWindow: 400_000,
    maxOutput: 128_000,
    reasoning: true,
    vision: true,
  },
  {
    id: "openai/gpt-5-mini",
    name: "GPT-5 Mini",
    version: "5-mini",
    inputPrice: 0.25,
    outputPrice: 2.0,
    contextWindow: 400_000,
    maxOutput: 128_000,
  },
  {
    id: "openai/o4-mini",
    name: "o4-mini",
    version: "4-mini",
    inputPrice: 1.1,
    outputPrice: 4.4,
    contextWindow: 200_000,
    maxOutput: 100_000,
    reasoning: true,
  },
  // DeepSeek
  {
    id: "deepseek/deepseek-v3.2",
    name: "DeepSeek V3.2",
    version: "v3.2",
    inputPrice: 0.25,
    outputPrice: 0.4,
    contextWindow: 163_840,
    maxOutput: 163_840,
  },
  {
    id: "deepseek/deepseek-v3.2-speciale",
    name: "DeepSeek V3.2 Speciale",
    version: "v3.2-speciale",
    inputPrice: 0.4,
    outputPrice: 1.2,
    contextWindow: 163_840,
    maxOutput: 65_536,
    reasoning: true,
  },
  {
    id: "deepseek/deepseek-r1",
    name: "DeepSeek R1",
    version: "r1",
    inputPrice: 0.7,
    outputPrice: 2.5,
    contextWindow: 64_000,
    maxOutput: 16_000,
    reasoning: true,
  },
  // Moonshot Kimi
  {
    id: "moonshotai/kimi-k2.5",
    name: "Kimi K2.5",
    version: "2.5",
    inputPrice: 0.45,
    outputPrice: 2.2,
    contextWindow: 262_144,
    maxOutput: 65_535,
    vision: true,
  },
  // MiniMax
  {
    id: "minimax/minimax-m2.5",
    name: "MiniMax M2.5",
    version: "2.5",
    inputPrice: 0.3,
    outputPrice: 1.1,
    contextWindow: 196_608,
    maxOutput: 65_536,
  },
];

function toOpenClawModel(m: OpenRouterModel): ModelDefinitionConfig {
  return {
    id: m.id,
    name: m.name,
    api: "openai-completions",
    reasoning: m.reasoning ?? false,
    input: m.vision ? ["text", "image"] : ["text"],
    cost: {
      input: m.inputPrice,
      output: m.outputPrice,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: m.contextWindow,
    maxTokens: m.maxOutput,
  };
}

const ALIAS_MODELS: ModelDefinitionConfig[] = Object.entries(MODEL_ALIASES)
  .map(([alias, targetId]) => {
    const target = OPENROUTER_MODELS.find((m) => m.id === targetId);
    if (!target) return null;
    return toOpenClawModel({ ...target, id: alias, name: `${alias} → ${target.name}` });
  })
  .filter((m): m is ModelDefinitionConfig => m !== null);

export const OPENCLAW_MODELS: ModelDefinitionConfig[] = [
  ...OPENROUTER_MODELS.map(toOpenClawModel),
  ...ALIAS_MODELS,
];

/**
 * Build a ModelProviderConfig for Clawd-router.
 *
 * @param baseUrl - The proxy's local base URL (e.g., "http://127.0.0.1:12345")
 */
export function buildProviderModels(baseUrl: string): ModelProviderConfig {
  return {
    baseUrl: `${baseUrl}/v1`,
    api: "openai-completions",
    models: OPENCLAW_MODELS,
  };
}

/**
 * Get context window size for a model.
 * Returns undefined if model not found.
 */
export function getModelContextWindow(modelId: string): number | undefined {
  const normalized = modelId.replace("clawd-router/", "");
  const model = OPENROUTER_MODELS.find((m) => m.id === normalized);
  return model?.contextWindow;
}
