import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { requireEnv } from '@/config'
import { err } from '@/domain/result'
import { createDb } from '@/infrastructure/db/client'
import { createMessageRepository } from '@/infrastructure/db/message-repository'
import {
  assistantMessages,
  conversations,
  modelPrices,
  models,
  usageRecords,
  userMessages,
  users,
} from '@/infrastructure/db/schema'
import { createBarrier } from '../../helpers/barrier'
import { truncateAllTables } from '../../helpers/database'
import { waitUntilWaitingForLock } from '../../helpers/lock'
import { unwrap } from '../../helpers/result'

describe('MessageRepository: 受付 INSERT の競合', () => {
  // Tx A・Tx B・ロック待ちの観測用で 3 接続使う
  const db = createDb({ connectionString: requireEnv('TEST_DATABASE_URL'), max: 3 })

  beforeEach(async () => {
    await truncateAllTables(db)
  })

  afterAll(async () => {
    await db.$client.end()
  })

  it('バリアで A の受付 INSERT（未コミット）→ B の受付 INSERT の順に固定したとき B は A のコミットまで待たされ 重複として扱われる', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    const message = {
      conversationId: conversation.id,
      clientMessageId: crypto.randomUUID(),
      content: 'こんにちは',
    }
    const aInserted = createBarrier()
    const bPid = Promise.withResolvers<number>()
    const events: string[] = []

    const txA = db.transaction(async (tx) => {
      const result = await createMessageRepository(tx).createUserMessage(message)
      if (!result.ok) throw new Error('準備: A の受付が失敗しました')
      aInserted.open()
      // B が A の INSERT の結末待ちに入ったのを確認してからコミットする（コールバックを抜けると COMMIT）
      await waitUntilWaitingForLock(db, await bPid.promise)
      events.push('A: commit')
    })
    const txB = (async () => {
      await aInserted.wait()
      return db.transaction(async (tx) => {
        const { rows } = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        const pid = rows[0]?.pid
        if (pid === undefined) {
          const error = new Error('準備: Tx B の pg_backend_pid() が取得できませんでした')
          bPid.reject(error)
          throw error
        }
        bPid.resolve(pid)
        const result = await createMessageRepository(tx).createUserMessage(message)
        events.push('B: inserted')
        return result
      })
    })()
    const [, resultB] = await Promise.all([txA, txB])

    expect(events).toEqual(['A: commit', 'B: inserted'])
    expect(resultB).toEqual(err({ type: 'duplicate_client_message' }))
    expect(await db.select().from(userMessages)).toHaveLength(1)
  })

  it('バリアで A の受付 INSERT（未コミット）→ B の受付 INSERT の順に固定し A がロールバックしたとき B の送信が受け付けられる', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    const message = {
      conversationId: conversation.id,
      clientMessageId: crypto.randomUUID(),
      content: 'こんにちは',
    }
    const aInserted = createBarrier()
    const bPid = Promise.withResolvers<number>()
    const rollbackA = new Error('A をロールバックさせる')

    const txA = db
      .transaction(async (tx) => {
        const result = await createMessageRepository(tx).createUserMessage(message)
        if (!result.ok) throw new Error('準備: A の受付が失敗しました')
        aInserted.open()
        await waitUntilWaitingForLock(db, await bPid.promise)
        // コールバックが throw すると ROLLBACK になる
        throw rollbackA
      })
      .catch((error: unknown) => {
        if (error !== rollbackA) throw error
      })
    const txB = (async () => {
      await aInserted.wait()
      return db.transaction(async (tx) => {
        const { rows } = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
        const pid = rows[0]?.pid
        if (pid === undefined) {
          const error = new Error('準備: Tx B の pg_backend_pid() が取得できませんでした')
          bPid.reject(error)
          throw error
        }
        bPid.resolve(pid)
        return createMessageRepository(tx).createUserMessage(message)
      })
    })()
    const [, resultB] = await Promise.all([txA, txB])

    const saved = await db.select().from(userMessages)
    expect(saved).toEqual([expect.objectContaining({ id: unwrap(resultB).id })])
  })
})

describe('MessageRepository: 応答の保存', () => {
  const db = createDb({ connectionString: requireEnv('TEST_DATABASE_URL') })

  beforeEach(async () => {
    await truncateAllTables(db)
  })

  afterAll(async () => {
    await db.$client.end()
  })

  it('同じ送信に応答を 2 回保存しようとしたとき 2 回目は拒否され 応答は 1 つのまま', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    const repository = createMessageRepository(db)
    const accepted = await repository.createUserMessage({
      conversationId: conversation.id,
      clientMessageId: crypto.randomUUID(),
      content: 'こんにちは',
    })
    const userMessageId = unwrap(accepted).id
    const [model] = await db.insert(models).values({ name: 'fake-model' }).returning()
    if (!model) throw new Error('準備: models の INSERT が行を返しませんでした')
    const [price] = await db
      .insert(modelPrices)
      .values({
        modelId: model.id,
        inputPerMillionTokens: 3_000,
        outputPerMillionTokens: 15_000,
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      })
      .returning()
    if (!price) throw new Error('準備: model_prices の INSERT が行を返しませんでした')
    const usage = { modelPriceId: price.id, inputTokens: 10, outputTokens: 30, credits: 1 }
    const first = await repository.complete({ userMessageId, content: '1 回目の応答', usage })

    const second = await repository.complete({ userMessageId, content: '2 回目の応答', usage })

    expect(second).toEqual(err({ type: 'duplicate_reply' }))
    expect(await db.select().from(assistantMessages)).toEqual([
      expect.objectContaining({ id: unwrap(first).id, content: '1 回目の応答' }),
    ])
  })

  it('応答を保存するとき 利用記録（トークン数・適用した単価・消費クレジット）も保存される', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    const [model] = await db.insert(models).values({ name: 'fake-model' }).returning()
    if (!model) throw new Error('準備: models の INSERT が行を返しませんでした')
    const [price] = await db
      .insert(modelPrices)
      .values({
        modelId: model.id,
        inputPerMillionTokens: 3_000,
        outputPerMillionTokens: 15_000,
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      })
      .returning()
    if (!price) throw new Error('準備: model_prices の INSERT が行を返しませんでした')
    const repository = createMessageRepository(db)
    const accepted = await repository.createUserMessage({
      conversationId: conversation.id,
      clientMessageId: crypto.randomUUID(),
      content: 'こんにちは',
    })
    const userMessageId = unwrap(accepted).id

    const result = await repository.complete({
      userMessageId,
      content: '応答',
      usage: { modelPriceId: price.id, inputTokens: 10, outputTokens: 30, credits: 1 },
    })

    expect(result.ok).toBe(true)
    expect(await db.select().from(usageRecords)).toEqual([
      expect.objectContaining({
        userMessageId,
        modelPriceId: price.id,
        inputTokens: 10,
        outputTokens: 30,
        credits: 1,
      }),
    ])
  })

  it('利用記録を保存できないとき 応答も保存されず 送信は生成中のまま（同じ Tx でロールバックされる）', async () => {
    const [alice] = await db.insert(users).values({ name: 'alice' }).returning()
    if (!alice) throw new Error('準備: users の INSERT が行を返しませんでした')
    const [conversation] = await db.insert(conversations).values({ userId: alice.id }).returning()
    if (!conversation) throw new Error('準備: conversations の INSERT が行を返しませんでした')
    const repository = createMessageRepository(db)
    const accepted = await repository.createUserMessage({
      conversationId: conversation.id,
      clientMessageId: crypto.randomUUID(),
      content: 'こんにちは',
    })
    const userMessageId = unwrap(accepted).id

    // 存在しない単価行を参照させ、利用記録の INSERT を FK 違反で失敗させる
    const result = await repository.complete({
      userMessageId,
      content: '応答',
      usage: { modelPriceId: crypto.randomUUID(), inputTokens: 10, outputTokens: 30, credits: 1 },
    })

    expect(result).toMatchObject(err({ type: 'database_error' }))
    expect(await db.select().from(assistantMessages)).toEqual([])
    expect(await db.select().from(usageRecords)).toEqual([])
    expect(await db.select().from(userMessages)).toEqual([
      expect.objectContaining({ id: userMessageId, status: 'generating' }),
    ])
  })
})
