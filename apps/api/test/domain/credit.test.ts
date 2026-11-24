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

  it('合計に端数が出るとき 切り上げたクレジット数に換算する', () => {
    // 10 × 3,000 / 1,000,000 + 30 × 15,000 / 1,000,000 = 0.03 + 0.45 = 0.48 → 1
    const credits = calculateCredits(
      { inputTokens: 10, outputTokens: 30 },
      { inputPerMillionTokens: 3_000, outputPerMillionTokens: 15_000 },
    )

    expect(credits).toBe(1)
  })

  it('入力と出力それぞれに端数が出るとき 合算してから 1 回だけ切り上げる', () => {
    // 入力 0.4 + 出力 0.4 = 0.8 → 1（入出力それぞれで切り上げると 1 + 1 = 2 になる）
    const credits = calculateCredits(
      { inputTokens: 400_000, outputTokens: 400_000 },
      { inputPerMillionTokens: 1, outputPerMillionTokens: 1 },
    )

    expect(credits).toBe(1)
  })
})
