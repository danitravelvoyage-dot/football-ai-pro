import type { ProviderCostTier } from "./types";
import type { PriceList } from "./cost";

export interface ProviderConfig {
  id: string;
  kind: "mock" | "openai-compatible";
  costTier: ProviderCostTier;
  enabled: boolean;
  /** A paid provider can only run after the owner explicitly approves it. */
  ownerApproved: boolean;
  dailyRequestLimit: number;
  baseUrl?: string;
  model?: string;
  secretEnv?: string;
  /** Retries of a retryable failure on this provider before moving on. Default 0. */
  maxRetries?: number;
  /** The owner's price list for this provider. Undefined when the owner has not entered prices: cost is then unknown. */
  price?: PriceList;
}

/** Reads an optional price per 1,000 tokens. Both must be set; otherwise the price is unknown. */
export function priceFrom(env: Record<string, string | undefined>, prefix: string): PriceList | undefined {
  const inPer1k = env[`${prefix}_PRICE_IN_PER_1K`];
  const outPer1k = env[`${prefix}_PRICE_OUT_PER_1K`];
  if (inPer1k === undefined || outPer1k === undefined) return undefined;
  const i = Number(inPer1k);
  const o = Number(outPer1k);
  if (!Number.isFinite(i) || !Number.isFinite(o) || i < 0 || o < 0) return undefined;
  return { inPer1k: i, outPer1k: o };
}

/** Reads provider configuration from environment variables. Pure: pass the env object in tests. */
export function loadProviderConfig(env: Record<string, string | undefined>): ProviderConfig[] {
  const localEnabled = env.AI_LOCAL_ENABLED === "true";
  const hostedEnabled = env.AI_HOSTED_FREE_ENABLED === "true";
  const paidApproved = (env.AI_OWNER_APPROVED_PAID_PROVIDERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const providers: ProviderConfig[] = [
    { id: "mock", kind: "mock", costTier: "free", enabled: true, ownerApproved: true, dailyRequestLimit: Number.MAX_SAFE_INTEGER },
    {
      id: "local-ollama",
      kind: "openai-compatible",
      costTier: "local",
      enabled: localEnabled,
      ownerApproved: true,
      dailyRequestLimit: Number(env.AI_LOCAL_DAILY_LIMIT ?? 500),
      baseUrl: env.AI_LOCAL_BASE_URL ?? "http://localhost:11434/v1",
      model: env.AI_LOCAL_MODEL ?? "qwen2.5:7b",
      maxRetries: Number(env.AI_LOCAL_MAX_RETRIES ?? 1),
      price: priceFrom(env, "AI_LOCAL"),
    },
    {
      id: "hosted-free",
      kind: "openai-compatible",
      costTier: "free",
      enabled: hostedEnabled,
      ownerApproved: true,
      dailyRequestLimit: Number(env.AI_HOSTED_DAILY_LIMIT ?? 100),
      baseUrl: env.AI_HOSTED_BASE_URL,
      model: env.AI_HOSTED_MODEL,
      secretEnv: "AI_HOSTED_API_KEY",
      maxRetries: Number(env.AI_HOSTED_MAX_RETRIES ?? 1),
      price: priceFrom(env, "AI_HOSTED"),
    },
    // Paid placeholders: disabled unless the owner lists them in AI_OWNER_APPROVED_PAID_PROVIDERS.
    {
      id: "paid-placeholder",
      kind: "openai-compatible",
      costTier: "paid",
      enabled: paidApproved.includes("paid-placeholder"),
      ownerApproved: paidApproved.includes("paid-placeholder"),
      dailyRequestLimit: Number(env.AI_PAID_DAILY_LIMIT ?? 0),
      baseUrl: env.AI_PAID_BASE_URL,
      model: env.AI_PAID_MODEL,
      secretEnv: "AI_PAID_API_KEY",
      maxRetries: Number(env.AI_PAID_MAX_RETRIES ?? 0),
      price: priceFrom(env, "AI_PAID"),
    },
  ];
  return providers;
}
