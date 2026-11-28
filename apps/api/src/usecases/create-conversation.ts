import type { ConversationRepository } from '@/usecases/ports/conversation-repository'

type Deps = {
  conversations: ConversationRepository
}

// 会話を新しく作る（持ち主は認証済みのユーザー）
export const createConversation = async (
  deps: Deps,
  input: { userId: string },
): Promise<{ conversationId: string }> => {
  const conversation = await deps.conversations.create(input.userId)
  return { conversationId: conversation.id }
}
