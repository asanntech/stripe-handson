import { eq } from 'drizzle-orm'
import { requireEnv } from '@/config'
import { createDb } from '@/infrastructure/db/client'
import { modelPrices, models } from '@/infrastructure/db/schema'
import { MODEL } from '@/usecases/send-message'

// 開発用 DB の初期データ（何度実行しても同じ状態になる）。
// 単価を登録・改定する API はスコープ外のため、送信に必要な単価をここで入れる
const db = createDb({ connectionString: requireEnv('DATABASE_URL') })
try {
  await db.insert(models).values({ name: MODEL }).onConflictDoNothing({ target: models.name })
  const [model] = await db.select().from(models).where(eq(models.name, MODEL))
  if (!model) throw new Error(`モデル ${MODEL} が見つかりません`)
  // 単価表は追記のみ（UPDATE はトリガーで拒否される）なので、既にある行は変えない
  const inserted = await db
    .insert(modelPrices)
    .values({
      modelId: model.id,
      inputPerMillionTokens: 3_000,
      outputPerMillionTokens: 15_000,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    })
    .onConflictDoNothing({ target: [modelPrices.modelId, modelPrices.effectiveFrom] })
    .returning({ id: modelPrices.id })
  console.log(
    inserted.length > 0
      ? `seed: ${MODEL} の単価を登録しました`
      : `seed: ${MODEL} の単価は登録済みのため変更しませんでした`,
  )
} finally {
  await db.$client.end()
}
