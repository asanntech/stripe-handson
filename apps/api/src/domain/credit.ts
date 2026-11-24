export type TokenUsage = { inputTokens: number; outputTokens: number }

export type UnitPrice = { inputPerMillionTokens: number; outputPerMillionTokens: number }

const TOKENS_PER_PRICE_UNIT = 1_000_000

// 入出力を合算してから 1 回だけ切り上げる（それぞれで切り上げると端数を二重に取るため）
export const calculateCredits = (usage: TokenUsage, price: UnitPrice): number =>
  Math.ceil(
    (usage.inputTokens * price.inputPerMillionTokens +
      usage.outputTokens * price.outputPerMillionTokens) /
      TOKENS_PER_PRICE_UNIT,
  )
