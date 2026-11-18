import { pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

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
export const userMessages = pgTable('user_messages', {
  id: uuid().primaryKey().defaultRandom(),
  conversationId: uuid()
    .notNull()
    .references(() => conversations.id),
  clientMessageId: uuid().notNull(),
  content: text().notNull(),
  status: userMessageStatus().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

// LLM の応答。送信 1 回につき 1 行（応答が完了したときだけ作られる）
export const assistantMessages = pgTable('assistant_messages', {
  id: uuid().primaryKey().defaultRandom(),
  userMessageId: uuid()
    .notNull()
    .references(() => userMessages.id),
  content: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})
