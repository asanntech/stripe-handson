import { pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

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
export const assistantMessages = pgTable('assistant_messages', {
  id: uuid().primaryKey().defaultRandom(),
  userMessageId: uuid()
    .notNull()
    .references(() => userMessages.id),
  content: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})
