import { and, desc, eq } from 'drizzle-orm'
import { chatbotConversation } from '../../../database/schema'
import { requireChatbotAccess } from '../../../utils/chatbotAccess'
import { toConversationSummary } from '../../../utils/chatbotConversation'
import type { ChatbotConversationSummary } from '../../../../shared/chatbot'

/**
 * GET /api/chatbot/conversations — list the caller's conversations,
 * pinned first, then most-recent.
 */
export default defineEventHandler(async (event): Promise<{ conversations: ChatbotConversationSummary[] }> => {
  const session = await requireChatbotAccess(event)
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id

  const rows = await db.query.chatbotConversation.findMany({
    where: and(
      eq(chatbotConversation.organizationId, orgId),
      eq(chatbotConversation.userId, userId),
    ),
    orderBy: [
      desc(chatbotConversation.pinned),
      desc(chatbotConversation.lastMessageAt),
      desc(chatbotConversation.createdAt),
    ],
    limit: 200,
  })

  return { conversations: rows.map(toConversationSummary) }
})
