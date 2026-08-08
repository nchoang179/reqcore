import { z } from 'zod'
import { chatbotPreference } from '../../database/schema'
import { requireChatbotAccess } from '../../utils/chatbotAccess'
import { isChatbotCatalogueModel } from '../../../shared/chatbot-models'
import type { ChatbotPreferences } from '../../../shared/chatbot'

const bodySchema = z.object({
  // Null clears the star and returns the user to the platform default. Unknown
  // ids are rejected rather than stored, so the column can only ever hold a
  // model the picker can actually render.
  defaultModel: z.string().min(1).nullable()
    .refine(m => m == null || isChatbotCatalogueModel(m), 'Unknown assistant model.'),
})

/**
 * PATCH /api/chatbot/preferences — star (or unstar) a default model.
 *
 * Upserts on (organizationId, userId): the row is created lazily on first use,
 * and the unique index makes a double-click from two tabs converge on one row
 * instead of racing to insert two.
 */
export default defineEventHandler(async (event): Promise<ChatbotPreferences> => {
  const session = await requireChatbotAccess(event)
  const orgId = session.session.activeOrganizationId
  const body = await readValidatedBody(event, bodySchema.parse)

  const [row] = await db.insert(chatbotPreference)
    .values({
      organizationId: orgId,
      userId: session.user.id,
      defaultModel: body.defaultModel,
    })
    .onConflictDoUpdate({
      target: [chatbotPreference.organizationId, chatbotPreference.userId],
      set: { defaultModel: body.defaultModel, updatedAt: new Date() },
    })
    .returning({ defaultModel: chatbotPreference.defaultModel })

  return { defaultModel: row?.defaultModel ?? null }
})
