import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { aiConfig, chatbotAgent, chatbotConversation, chatbotFolder, job } from '../../../database/schema'
import { requireChatbotAccess } from '../../../utils/chatbotAccess'
import { isBillingDisabled, resolveOrgPlanId } from '../../../utils/billing/plan'
import {
  isPlatformEngineId,
  platformPinUpdate,
  toConversationSummary,
} from '../../../utils/chatbotConversation'
import { PLATFORM_ENGINE_ID, type ChatbotConversationSummary } from '../../../../shared/chatbot'
import {
  FREE_PLAN_CHATBOT_MODEL_ID,
  isChatbotCatalogueModel,
} from '../../../../shared/chatbot-models'

const bodySchema = z.object({
  title: z.string().min(1).max(120).trim().optional(),
  folderId: z.string().min(1).nullable().optional(),
  agentId: z.string().min(1).nullable().optional(),
  aiConfigId: z.string().min(1).nullable().optional(),
  // See index.post.ts — unknown ids are rejected, never coerced.
  model: z.string().min(1).nullable().optional()
    .refine(m => m == null || isChatbotCatalogueModel(m), 'Unknown assistant model.'),
  scope: z.object({
    kind: z.enum(['organization', 'job']),
    jobId: z.string().min(1).optional(),
  }).optional(),
  thinking: z.boolean().optional(),
  pinned: z.boolean().optional(),
})

/**
 * PATCH /api/chatbot/conversations/[id]
 *
 * Rename, re-file (folder), re-assign agent, change scope, toggle pin.
 */
export default defineEventHandler(async (event): Promise<{ conversation: ChatbotConversationSummary }> => {
  const session = await requireChatbotAccess(event)
  const orgId = session.session.activeOrganizationId
  const userId = session.user.id
  const { id } = await getValidatedRouterParams(event, z.object({ id: z.string().uuid() }).parse)

  const body = await readValidatedBody(event, bodySchema.parse)
  const plan = await resolveOrgPlanId(orgId)
  const freePlanRestrictionsApply = !isBillingDisabled() && plan === 'free'
  const effectiveAiConfigId = freePlanRestrictionsApply
    ? PLATFORM_ENGINE_ID
    : body.aiConfigId

  if (body.folderId) {
    const f = await db.query.chatbotFolder.findFirst({
      where: and(
        eq(chatbotFolder.id, body.folderId),
        eq(chatbotFolder.organizationId, orgId),
        eq(chatbotFolder.userId, userId),
      ),
      columns: { id: true },
    })
    if (!f) throw createError({ statusCode: 404, statusMessage: 'Folder not found.' })
  }
  if (body.agentId) {
    const a = await db.query.chatbotAgent.findFirst({
      where: and(
        eq(chatbotAgent.id, body.agentId),
        eq(chatbotAgent.organizationId, orgId),
        eq(chatbotAgent.userId, userId),
      ),
      columns: { id: true },
    })
    if (!a) throw createError({ statusCode: 404, statusMessage: 'Agent not found.' })
  }
  // The platform engine has no ai_config row — see index.post.ts.
  if (effectiveAiConfigId && !isPlatformEngineId(effectiveAiConfigId)) {
    const c = await db.query.aiConfig.findFirst({
      where: and(eq(aiConfig.id, effectiveAiConfigId), eq(aiConfig.organizationId, orgId)),
      columns: { id: true },
    })
    if (!c) throw createError({ statusCode: 404, statusMessage: 'AI configuration not found.' })
  }
  if (body.scope?.kind === 'job') {
    if (!body.scope.jobId) {
      throw createError({ statusCode: 400, statusMessage: 'jobId required for job scope.' })
    }
    const j = await db.query.job.findFirst({
      where: and(eq(job.id, body.scope.jobId), eq(job.organizationId, orgId)),
      columns: { id: true },
    })
    if (!j) throw createError({ statusCode: 404, statusMessage: 'Job not found.' })
  }

  const updates: Partial<typeof chatbotConversation.$inferInsert> = { updatedAt: new Date() }
  if (body.title !== undefined) updates.title = body.title
  if (body.folderId !== undefined) updates.folderId = body.folderId
  if (body.agentId !== undefined) updates.agentId = body.agentId
  if (effectiveAiConfigId !== undefined) Object.assign(updates, platformPinUpdate(effectiveAiConfigId))
  if (body.model !== undefined) updates.chatbotModel = body.model
  // Switching to a BYOK config drops the model pin: that config brings its own
  // model, so leaving the pin would resurrect it if the user switched back to
  // the platform engine later, silently changing what they're billed for.
  if (body.aiConfigId !== undefined && !isPlatformEngineId(body.aiConfigId)) {
    updates.chatbotModel = null
  }
  if (freePlanRestrictionsApply) {
    Object.assign(updates, platformPinUpdate(PLATFORM_ENGINE_ID))
    updates.chatbotModel = FREE_PLAN_CHATBOT_MODEL_ID
  }
  if (body.scope !== undefined) updates.scope = body.scope
  if (body.thinking !== undefined) updates.thinking = body.thinking
  if (body.pinned !== undefined) updates.pinned = body.pinned

  const [updated] = await db.update(chatbotConversation)
    .set(updates)
    .where(and(
      eq(chatbotConversation.id, id),
      eq(chatbotConversation.organizationId, orgId),
      eq(chatbotConversation.userId, userId),
    ))
    .returning()

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found.' })
  }

  return { conversation: toConversationSummary(updated) }
})
