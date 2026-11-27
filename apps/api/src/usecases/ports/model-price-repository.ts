import type { UnitPrice } from '@/domain/credit'

// 単価表の 1 行（利用記録はこの id で適用した単価を参照する）
export type ModelPrice = UnitPrice & { id: string }

export interface ModelPriceRepository {
  // その時点で有効なモデルの単価。未登録なら null
  findEffective(key: { model: string; at: Date }): Promise<ModelPrice | null>
}
