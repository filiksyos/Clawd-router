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
  agentic?: boolean;
};

export const MODEL_ALIASES: Record<string, string> = {
  claude: "anthropic/claude-sonnet-4-5",
  sonnet: "anthropic/claude-sonnet-4-5",
  opus: "anthropic/claude-opus-4-5",
  haiku: "anthropic/claude-haiku-4-5",
  gemini: "google/gemini-2.5-pro",
  flash: "google/gemini-2.5-flash",
  gpt: "openai/gpt-4o",
  mini: "openai/gpt-4o-mini",
  deepseek: "deepseek/deepseek-chat",
  r1: "deepseek/deepseek-r1",
  "auto-router": "auto",
  router: "auto",
  kimi: "moonshotai/kimi-k2.5",
  "grok-fast": "x-ai/grok-4.1-fast-non-reasoning",
  "grok-code": "x-ai/grok-code-fast-1",
  grok: "x-ai/grok-3",
  minimax: "minimax/minimax-m2.5",
  eco: "eco",
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
  {
    id: "eco",
    name: "Eco (Smart Router - Cost Optimized)",
    inputPrice: 0,
    outputPrice: 0,
    contextWindow: 1_050_000,
    maxOutput: 128_000,
  },
  {
    id: "google/gemini-2.5-flash-lite-preview",
    name: "Gemini 2.5 Flash Lite Preview",
    version: "2.5",
    inputPrice: 0.1,
    outputPrice: 0.4,
    contextWindow: 1_000_000,
    maxOutput: 65_536,
  },
  {
    id: "google/gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    version: "2.5",
    inputPrice: 0.3,
    outputPrice: 2.5,
    contextWindow: 1_000_000,
    maxOutput: 65_536,
  },
  {
    id: "google/gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    version: "2.5",
    inputPrice: 1.25,
    outputPrice: 10.0,
    contextWindow: 1_050_000,
    maxOutput: 65_536,
    reasoning: true,
    vision: true,
  },
  {
    id: "anthropic/claude-sonnet-4-5",
    name: "Claude Sonnet 4.5",
    version: "4.5",
    inputPrice: 3.0,
    outputPrice: 15.0,
    contextWindow: 200_000,
    maxOutput: 64_000,
    reasoning: true,
  },
  {
    id: "anthropic/claude-opus-4-5",
    name: "Claude Opus 4.5",
    version: "4.5",
    inputPrice: 15.0,
    outputPrice: 75.0,
    contextWindow: 200_000,
    maxOutput: 32_000,
    reasoning: true,
  },
  {
    id: "anthropic/claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    version: "4.5",
    inputPrice: 1.0,
    outputPrice: 5.0,
    contextWindow: 200_000,
    maxOutput: 8_192,
  },
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    version: "4o",
    inputPrice: 2.5,
    outputPrice: 10.0,
    contextWindow: 128_000,
    maxOutput: 16_384,
    vision: true,
  },
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o Mini",
    version: "4o-mini",
    inputPrice: 0.15,
    outputPrice: 0.6,
    contextWindow: 128_000,
    maxOutput: 16_384,
  },
  {
    id: "openai/o3-mini",
    name: "o3-mini",
    version: "3-mini",
    inputPrice: 1.1,
    outputPrice: 4.4,
    contextWindow: 128_000,
    maxOutput: 65_536,
    reasoning: true,
  },
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek Chat",
    version: "v3.2",
    inputPrice: 0.28,
    outputPrice: 0.28,
    contextWindow: 128_000,
    maxOutput: 8_192,
  },
  {
    id: "deepseek/deepseek-r1",
    name: "DeepSeek R1",
    version: "r1",
    inputPrice: 0.55,
    outputPrice: 2.19,
    contextWindow: 128_000,
    maxOutput: 8_192,
    reasoning: true,
  },
  {
    id: "moonshotai/kimi-k2.5",
    name: "Kimi K2.5",
    inputPrice: 0.6,
    outputPrice: 3.0,
    contextWindow: 262_144,
    maxOutput: 8_192,
    reasoning: true,
    vision: true,
    agentic: true,
  },
  {
    id: "x-ai/grok-code-fast-1",
    name: "Grok Code Fast",
    inputPrice: 0.2,
    outputPrice: 1.5,
    contextWindow: 131_072,
    maxOutput: 16_384,
    agentic: true,
  },
  {
    id: "x-ai/grok-4.1-fast-non-reasoning",
    name: "Grok 4.1 Fast",
    inputPrice: 0.2,
    outputPrice: 0.5,
    contextWindow: 131_072,
    maxOutput: 16_384,
  },
  {
    id: "x-ai/grok-4.1-fast-reasoning",
    name: "Grok 4.1 Fast Reasoning",
    inputPrice: 0.2,
    outputPrice: 0.5,
    contextWindow: 131_072,
    maxOutput: 16_384,
    reasoning: true,
  },
  {
    id: "x-ai/grok-4-0709",
    name: "Grok 4",
    inputPrice: 0.2,
    outputPrice: 1.5,
    contextWindow: 131_072,
    maxOutput: 16_384,
    reasoning: true,
  },
  {
    id: "x-ai/grok-3",
    name: "Grok 3",
    inputPrice: 3.0,
    outputPrice: 15.0,
    contextWindow: 131_072,
    maxOutput: 16_384,
    reasoning: true,
  },
  {
    id: "x-ai/grok-3-mini",
    name: "Grok 3 Mini",
    inputPrice: 0.3,
    outputPrice: 0.5,
    contextWindow: 131_072,
    maxOutput: 16_384,
  },
  {
    id: "minimax/minimax-m2.5",
    name: "MiniMax M2.5",
    inputPrice: 0.3,
    outputPrice: 1.2,
    contextWindow: 204_800,
    maxOutput: 16_384,
    reasoning: true,
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

const REAL_MODEL_IDS = new Set(OPENROUTER_MODELS.map((m) => m.id));

const ALIAS_MODELS: ModelDefinitionConfig[] = Object.entries(MODEL_ALIASES)
  .filter(([alias]) => !REAL_MODEL_IDS.has(alias))
  .map(([alias, targetId]) => {
    const target = OPENROUTER_MODELS.find((m) => m.id === targetId);
    if (!target || alias === targetId) return null;
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
