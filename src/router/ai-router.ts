/**
 * AI Routing Agent
 *
 * Uses an LLM to select the best model for the latest user message.
 * Owns turn cache, system prompt, and OpenRouter routing agent call.
 */

import { createHash } from "node:crypto";
import { OPENROUTER_MODELS } from "../models.js";
import { fetchWithRetry } from "../retry.js";
import type { AIRoutingConfig, TurnCacheEntry } from "./types.js";

/**
 * Capability descriptions for OpenClaw routing.
 * Optimized for: coding, browsing, tool use, agent tasks, long context.
 * Research: OpenClaw best models 2025–2026, OpenRouter availability.
 */
const CAPABILITY_DESCRIPTIONS: Record<string, string> = {
  // Google Gemini
  "google/gemini-2.5-flash-lite":
    "Ultra-cheap and fast. Best for simple questions, greetings, translations, factual lookups.",
  "google/gemini-2.5-flash":
    "Balanced speed and capability. Best for general tasks, summaries, moderate coding, Q&A.",
  "google/gemini-2.5-pro":
    "High capability with reasoning. Best for complex analysis, hard coding problems, architecture design.",
  // Anthropic Claude
  "anthropic/claude-sonnet-4-6":
    "Best all-around for OpenClaw. Excellent reasoning, coding, tool use. Recommended daily driver.",
  "anthropic/claude-opus-4-6":
    "Most capable Anthropic model. Best for hardest agent tasks, long-context coding, deep reasoning.",
  // OpenAI
  "openai/gpt-5.2":
    "OpenAI frontier model with adaptive reasoning. Best for math, coding, tool calling, vision.",
  "openai/gpt-5-mini":
    "Cheap and fast OpenAI. Best for simple tasks, quick lookups, light coding.",
  "openai/o4-mini":
    "OpenAI reasoning model. Best for math, logic, formal proofs, algorithmic problems.",
  // DeepSeek
  "deepseek/deepseek-v3.2":
    "Very cheap and capable. Best for coding and general tasks on a tight budget.",
  "deepseek/deepseek-v3.2-speciale":
    "DeepSeek reasoning variant. Best for math, logic, agentic tasks on a budget.",
  "deepseek/deepseek-r1":
    "DeepSeek reasoning model. Best for math, logic, and reasoning tasks on a budget.",
  // Moonshot Kimi
  "moonshotai/kimi-k2.5":
    "Top free-tier choice. Multimodal, strong agentic tool use, visual coding. Close to Claude Sonnet quality.",
  // MiniMax
  "minimax/minimax-m2.5":
    "SOTA coding and agents. Best for software engineering, tool use, long agent sessions. ~$1/hr.",
};

function buildRoutingPrompt(previousModel: string | null): string {
  const lines: string[] = [
    "You are a routing agent. Select ONE model for the LATEST user message.",
    "",
    "Context:",
    previousModel
      ? `- Previous model used: ${previousModel}`
      : "- This is the first turn (no previous model).",
    "",
    "Available models (cheapest first):",
  ];
  const sorted = [...OPENROUTER_MODELS]
    .filter((m) => m.id !== "auto")
    .sort((a, b) => a.inputPrice - b.inputPrice);
  for (const m of sorted) {
    const desc = CAPABILITY_DESCRIPTIONS[m.id] ?? "General purpose.";
    const cost = `$${m.inputPrice.toFixed(2)}/$${m.outputPrice.toFixed(2)} per 1M tokens`;
    lines.push(`- ${m.id} — ${desc} — ${cost}`);
  }
  lines.push(
    "",
    "Instructions:",
    "1. From the conversation, infer whether the PREVIOUS turn succeeded (good assistant response) or struggled (errors, user corrections, confusion).",
    "2. ESCALATE to a more capable model if the previous model struggled or the new task is clearly harder.",
    "3. DOWNGRADE to a cheaper model if the previous turn went well and the new task is simple.",
    "4. Default to the cheapest model that fits. Use expensive models only when needed.",
    "5. Return ONLY the model ID, nothing else.",
  );
  return lines.join("\n");
}

const turnCache = new Map<string, TurnCacheEntry>();

function computeCacheKey(messages: unknown[]): string {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if ((messages[i] as { role?: string }).role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  const slice = lastUserIdx >= 0 ? messages.slice(0, lastUserIdx + 1) : messages;
  const json = JSON.stringify(slice);
  return createHash("sha256").update(json).digest("hex");
}

/** Key for previous turn (messages before last assistant + last user). */
function computePreviousTurnKey(messages: unknown[]): string | null {
  if (messages.length < 2) return null;
  return computeCacheKey(messages.slice(0, -2));
}

export class RoutingError extends Error {
  readonly type = "routing_error";
  constructor(message: string) {
    super(message);
    this.name = "RoutingError";
  }
}

export async function routeWithAI(
  messages: unknown[],
  apiKey: string,
  config: AIRoutingConfig,
): Promise<string> {
  const cacheKey = computeCacheKey(messages);
  const entry = turnCache.get(cacheKey);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.modelId;
  }

  const previousTurnKey = computePreviousTurnKey(messages);
  const previousModel =
    previousTurnKey && turnCache.has(previousTurnKey)
      ? turnCache.get(previousTurnKey)!.modelId
      : null;

  const routingMessages = [...messages];
  while (JSON.stringify(routingMessages).length > config.promptTruncationChars) {
    routingMessages.shift();
  }

  const systemPrompt = buildRoutingPrompt(previousModel);

  let response: Response;
  try {
    response = await fetchWithRetry(
      fetch,
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: systemPrompt },
            ...routingMessages,
          ],
          temperature: config.temperature,
          max_tokens: config.maxTokens,
        }),
      },
    );
  } catch (err) {
    throw new RoutingError(
      `Routing agent call failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!response.ok) {
    const bodyText = await response.text();
    throw new RoutingError(
      `Routing agent call failed: HTTP ${response.status} — ${bodyText}`,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawValue = (data.choices?.[0]?.message?.content ?? "")
    .trim()
    .split("\n")[0]
    .trim();

  const isValid = OPENROUTER_MODELS.some(
    (m) => m.id === rawValue && m.id !== "auto",
  );
  if (isValid) {
    turnCache.set(cacheKey, {
      modelId: rawValue,
      expiresAt: Date.now() + config.cacheTtlMs,
    });
    return rawValue;
  }

  throw new RoutingError(`Routing agent returned unknown model: "${rawValue}"`);
}

export function clearRoutingCache(): void {
  turnCache.clear();
}
