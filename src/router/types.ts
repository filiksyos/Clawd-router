export type AIRoutingConfig = {
  model: string;
  maxTokens: number;
  temperature: number;
  cacheTtlMs: number;
  promptTruncationChars: number;
};

export type TurnCacheEntry = {
  modelId: string;
  expiresAt: number;
};

export type RoutingDecision = {
  model: string;
  method: "llm";
  reasoning: string;
  costEstimate: number;
};

export type RoutingConfig = {
  version: string;
  aiRouting: AIRoutingConfig;
};
