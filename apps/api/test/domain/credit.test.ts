import { describe, expect, it } from 'vitest'
import { calculateCredits } from '@/domain/credit'

describe('クレジット換算', () => {
  it('入出力トークンに単価を掛けた合計が整数のとき そのクレジット数に換算する', () => {
    // 100 万トークンあたりの単価: 入力 3,000・出力 15,000
    // 1,000 × 3,000 / 1,000,000 + 200 × 15,000 / 1,000,000 = 3 + 3 = 6
    const credits = calculateCredits(
      { inputTokens: 1_000, outputTokens: 200 },
      { inputPerMillionTokens: 3_000, outputPerMillionTokens: 15_000 },
    )

    expect(credits).toBe(6)
  })

  it('入出力の単価が異なる組み合わせでも 入力と出力それぞれの単価で換算した合計を返す', () => {
    // 2,000,000 × 500 / 1,000,000 + 1,000,000 × 2,000 / 1,000,000 = 1,000 + 2,000 = 3,000
    const credits = calculateCredits(
      { inputTokens: 2_000_000, outputTokens: 1_000_000 },
      { inputPerMillionTokens: 500, outputPerMillionTokens: 2_000 },
    )

    expect(credits).toBe(3_000)
  })
})
