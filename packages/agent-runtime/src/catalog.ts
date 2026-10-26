// The curated model catalog shipped with Legible (engineering plan §8.6).
// Prices are USD per million tokens at Anthropic first-party rates (Bedrock
// and Vertex bill separately). A model is "recommended" only once it passes
// Legible's evals for its tier; until the eval harness lands (M3) the
// current-generation defaults are marked recommended by fiat.

import type {
  ModelInfo,
  ModelTier,
  Provider,
  TierAssignment,
} from "@legible/domain"

export const MODEL_CATALOG: ModelInfo[] = [
  {
    provider: "anthropic",
    id: "claude-opus-5-5",
    displayName: "Claude Opus 5.5",
    inputPrice: 4,
    outputPrice: 20,
    contextWindow: 1_000_000,
    status: "recommended",
    costRank: 3,
    tiers: ["strong"],
  },
  {
    provider: "anthropic",
    id: "claude-sonnet-5-5",
    displayName: "Claude Sonnet 5.5",
    inputPrice: 2,
    outputPrice: 10,
    contextWindow: 1_000_000,
    status: "recommended",
    costRank: 2,
    tiers: ["strong", "mid", "fast"],
  },
  {
    provider: "anthropic",
    id: "claude-haiku-5-5",
    displayName: "Claude Haiku 5.5",
    inputPrice: 0.1,
    outputPrice: 0.5,
    contextWindow: 1_000_000,
    status: "recommended",
    costRank: 1,
    tiers: ["mid", "fast"],
  },
  {
    provider: "anthropic",
    id: "claude-fable-5-1",
    displayName: "Claude Fable 5.1",
    inputPrice: 10,
    outputPrice: 50,
    contextWindow: 1_000_000,
    status: "experimental",
    costRank: 3,
    tiers: ["strong"],
  },
]

export const DEFAULT_TIERS: Record<ModelTier, TierAssignment> = {
  strong: { provider: "anthropic", model: "claude-opus-5-5" },
  mid: { provider: "anthropic", model: "claude-sonnet-5-5" },
  fast: { provider: "anthropic", model: "claude-haiku-5-5" },
}

export function findModel(provider: Provider, id: string): ModelInfo | null {
  return (
    MODEL_CATALOG.find((m) => m.provider === provider && m.id === id) ?? null
  )
}

/** Rough cost estimate for a run, from the price table. */
export function estimateCostUsd(
  model: ModelInfo | null,
  inputTokens: number,
  outputTokens: number,
): number | null {
  if (!model || model.inputPrice === null || model.outputPrice === null)
    return null
  return (
    (inputTokens * model.inputPrice + outputTokens * model.outputPrice) /
    1_000_000
  )
}
