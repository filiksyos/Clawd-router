/**
 * Smart Router Entry Point
 *
 * Async orchestration layer for AI-based model routing.
 */

import { routeWithAI, RoutingError } from "./ai-router.js";
import { calculateModelCost, type ModelPricing } from "./selector.js";
import type { RoutingDecision, RoutingConfig } from "./types.js";
import { DEFAULT_ROUTING_CONFIG } from "./config.js";

export async function route(
  messages: unknown[],
  apiKey: string,
  config: RoutingConfig,
  modelPricing: Map<string, ModelPricing>,
  maxOutputTokens: number,
): Promise<RoutingDecision> {
  const modelId = await routeWithAI(messages, apiKey, config.aiRouting);
  const estimatedInputTokens = Math.ceil(JSON.stringify(messages).length / 4);
  const { costEstimate } = calculateModelCost(
    modelId,
    modelPricing,
    estimatedInputTokens,
    maxOutputTokens,
  );
  return {
    model: modelId,
    method: "llm",
    reasoning: modelId,
    costEstimate,
  };
}

export { DEFAULT_ROUTING_CONFIG } from "./config.js";
export { calculateModelCost } from "./selector.js";
export type { RoutingDecision, RoutingConfig } from "./types.js";
export type { ModelPricing } from "./selector.js";
export { RoutingError } from "./ai-router.js";
