import { integer, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const conversations = pgTable('conversations', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid()
    .notNull()
    .references(() => users.id),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const userMessageStatus = pgEnum('user_message_status', [
  'generating',
  'completed',
  'failed',
])

// ユーザーの送信。受付時に「生成中」で INSERT し、応答の保存とともに「完了」にする
export const userMessages = pgTable(
  'user_messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id),
    clientMessageId: uuid().notNull(),
    content: text().notNull(),
    status: userMessageStatus().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  // 二重送信（リトライ・連打）の判定は、先に SELECT せずこの制約で行う
  (t) => [
    unique('user_messages_conversation_id_client_message_id_unique').on(
      t.conversationId,
      t.clientMessageId,
    ),
  ],
)

// LLM の応答。送信 1 回につき 1 行（応答が完了したときだけ作られる）
export const assistantMessages = pgTable(
  'assistant_messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    userMessageId: uuid()
      .notNull()
      .references(() => userMessages.id),
    content: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  // 送信 1 回に応答は 1 つだけ（アプリの排他をすり抜けた二重保存を止める最後の砦）
  (t) => [unique('assistant_messages_user_message_id_unique').on(t.userMessageId)],
)

// LLM のモデル（マスタ）。単価は履歴を持つので model_prices に置く（models 1 : N model_prices）
export const models = pgTable('models', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull().unique(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

// 単価表（履歴）。改定は既存行を UPDATE せず、新しい適用開始日時の行を追加する。
// 単価は 100 万トークンあたりのクレジット（整数）
export const modelPrices = pgTable(
  'model_prices',
  {
    id: uuid().primaryKey().defaultRandom(),
    modelId: uuid()
      .notNull()
      .references(() => models.id),
    inputPerMillionTokens: integer().notNull(),
    outputPerMillionTokens: integer().notNull(),
    effectiveFrom: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('model_prices_model_id_effective_from_unique').on(t.modelId, t.effectiveFrom)],
)

// 利用履歴。適用した単価は model_prices の行を参照する（単価表は追記のみなので、参照先の単価は変わらない）
export const usageRecords = pgTable('usage_records', {
  id: uuid().primaryKey().defaultRandom(),
  userMessageId: uuid()
    .notNull()
    .references(() => userMessages.id),
  modelPriceId: uuid()
    .notNull()
    .references(() => modelPrices.id),
  inputTokens: integer().notNull(),
  outputTokens: integer().notNull(),
  credits: integer().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})
