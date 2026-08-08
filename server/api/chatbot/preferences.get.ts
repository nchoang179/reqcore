import { and, eq } from 'drizzle-orm'
import { chatbotPreference } from '../../database/schema'
import { requireChatbotAccess } from '../../utils/chatbotAccess'
import { isChatbotCatalogueModel } from '../../../shared/chatbot-models'
import type { ChatbotPreferences } from '../../../shared/chatbot'

/**
 * GET /api/chatbot/preferences — the caller's own assistant defaults.
 *
 * No row yet is the normal case for a user who has never starred a model, so it
 * returns the empty preference rather than a 404.
 */
export default defineEventHandler(async (event): Promise<ChatbotPreferences> => {
  const session = await requireChatbotAccess(event)

  const row = await db.query.chatbotPreference.findFirst({
    where: and(
      eq(chatbotPreference.organizationId, session.session.activeOrganizationId),
      eq(chatbotPreference.userId, session.user.id),
    ),
    columns: { defaultModel: true },
  })

  // A model retired from the catalogue since it was starred reads as no
  // preference. Returning the dead id would leave the picker showing a star on
  // a model it can no longer render.
  return {
    defaultModel: isChatbotCatalogueModel(row?.defaultModel) ? row!.defaultModel : null,
  }
})
