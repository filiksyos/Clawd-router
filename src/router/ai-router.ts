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

const CAPABILITY_DESCRIPTIONS: Record<string, string> = {
  "google/gemini-2.5-flash-lite-preview":
    "Ultra-cheap and fast. Best for simple questions, greetings, translations, factual lookups.",
  "google/gemini-2.5-flash":
    "Balanced speed and capability. Best for general tasks, summaries, moderate coding, Q&A.",
  "google/gemini-2.5-pro":
    "High capability with reasoning. Best for complex analysis, hard coding problems, architecture design.",
  "anthropic/claude-sonnet-4-5":
    "Excellent reasoning and coding. Best for nuanced tasks, complex code, multi-step reasoning.",
  "anthropic/claude-opus-4-5":
    "Most capable Anthropic model. Best for the hardest tasks requiring deep reasoning.",
  "anthropic/claude-haiku-4-5":
    "Fast and cheap Anthropic model. Best for simple tasks where Anthropic style is preferred.",
  "openai/gpt-4o":
    "Strong general-purpose model with vision. Best for diverse tasks, image understanding.",
  "openai/gpt-4o-mini":
    "Cheap OpenAI model. Best for simple tasks where OpenAI style is preferred.",
  "openai/o3-mini":
    "OpenAI reasoning model. Best for math, logic, formal proofs, algorithmic problems.",
  "deepseek/deepseek-chat":
    "Very cheap and capable. Best for coding and general tasks on a tight budget.",
  "deepseek/deepseek-r1":
    "DeepSeek reasoning model. Best for math, logic, and reasoning tasks on a budget.",
};

const ROUTING_SYSTEM_PROMPT = (() => {
  const lines: string[] = [
    "You are a routing agent. Select the single best model for the LATEST user message from the conversation. Consider cost vs. capability — prefer cheaper models when they suffice.",
    "",
    "Available models:",
  ];
  for (const m of OPENROUTER_MODELS) {
    if (m.id === "auto") continue;
    const desc = CAPABILITY_DESCRIPTIONS[m.id] ?? "General purpose.";
    const cost = `$${m.inputPrice.toFixed(2)}/$${m.outputPrice.toFixed(2)} per 1M tokens (input/output)`;
    lines.push(`- ${m.id} — ${desc} — ${cost}`);
  }
  lines.push(
    "",
    "Instructions:",
    "1. Focus ONLY on the LATEST user message. The conversation history is provided for context only — do not let prior task complexity bias your decision.",
    "2. Return ONLY the model ID, nothing else — no explanation, no punctuation, no quotes.",
  );
  return lines.join("\n");
})();

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

  const routingMessages = [...messages];
  while (JSON.stringify(routingMessages).length > config.promptTruncationChars) {
    routingMessages.shift();
  }

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
            { role: "system", content: ROUTING_SYSTEM_PROMPT },
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
