/**
 * Model cost calculation utilities.
 */

export type ModelPricing = {
  inputPrice: number; // per 1M tokens
  outputPrice: number; // per 1M tokens
};

const BASELINE_MODEL_ID = "anthropic/claude-opus-4-5";

/**
 * Calculate cost for a specific model (used when fallback model is used).
 * Returns updated cost fields for RoutingDecision.
 */
export function calculateModelCost(
  model: string,
  modelPricing: Map<string, ModelPricing>,
  estimatedInputTokens: number,
  maxOutputTokens: number,
  routingProfile?: "free" | "eco" | "auto" | "premium",
): { costEstimate: number; baselineCost: number; savings: number } {
  const pricing = modelPricing.get(model);

  // Defensive: guard against undefined price fields (not just undefined pricing)
  const inputPrice = pricing?.inputPrice ?? 0;
  const outputPrice = pricing?.outputPrice ?? 0;
  const inputCost = (estimatedInputTokens / 1_000_000) * inputPrice;
  const outputCost = (maxOutputTokens / 1_000_000) * outputPrice;
  const costEstimate = inputCost + outputCost;

  // Baseline: what Claude Opus 4.5 would cost (the premium reference)
  const opusPricing = modelPricing.get(BASELINE_MODEL_ID);
  const opusInputPrice = opusPricing?.inputPrice ?? 0;
  const opusOutputPrice = opusPricing?.outputPrice ?? 0;
  const baselineInput = (estimatedInputTokens / 1_000_000) * opusInputPrice;
  const baselineOutput = (maxOutputTokens / 1_000_000) * opusOutputPrice;
  const baselineCost = baselineInput + baselineOutput;

  // Premium profile doesn't calculate savings (it's about quality, not cost)
  const savings =
    routingProfile === "premium"
      ? 0
      : baselineCost > 0
        ? Math.max(0, (baselineCost - costEstimate) / baselineCost)
        : 0;

  return { costEstimate, baselineCost, savings };
}
