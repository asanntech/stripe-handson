export type TokenUsage = { inputTokens: number; outputTokens: number }

export type UnitPrice = { inputPerMillionTokens: number; outputPerMillionTokens: number }

const TOKENS_PER_PRICE_UNIT = 1_000_000

export const calculateCredits = (usage: TokenUsage, price: UnitPrice): number =>
  (usage.inputTokens * price.inputPerMillionTokens +
    usage.outputTokens * price.outputPerMillionTokens) /
  TOKENS_PER_PRICE_UNIT
