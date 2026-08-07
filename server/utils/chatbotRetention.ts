import { asc, inArray, lte } from 'drizzle-orm'
import { chatbotConversation } from '../database/schema'

/** Chat history is operational workspace data, not an indefinite archive. */
export const CHATBOT_CONVERSATION_RETENTION_DAYS = 180
const CHATBOT_RETENTION_BATCH_SIZE = 1_000

export async function pruneExpiredChatbotConversations(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - CHATBOT_CONVERSATION_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const expired = await db.query.chatbotConversation.findMany({
    where: lte(chatbotConversation.updatedAt, cutoff),
    columns: { id: true },
    orderBy: [asc(chatbotConversation.updatedAt)],
    limit: CHATBOT_RETENTION_BATCH_SIZE,
  })
  if (expired.length === 0) return 0

  const deleted = await db.delete(chatbotConversation)
    .where(inArray(chatbotConversation.id, expired.map(row => row.id)))
    .returning({ id: chatbotConversation.id })
  logInfo('chatbot.retention_pruned', {
    conversations: deleted.length,
    retention_days: CHATBOT_CONVERSATION_RETENTION_DAYS,
  })
  return deleted.length
}
