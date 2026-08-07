import { eq } from 'drizzle-orm'
import { aiConfig, platformAiConfig } from '../../database/schema'
import { createAiConfigSchema } from '../../utils/schemas/scoring'
import { encrypt } from '../../utils/encryption'

/**
 * POST /api/ai-config
 *
 * Create a new AI configuration. The API key is required and is encrypted
 * with AES-256-GCM before storage. If `isDefaultChatbot` or `isDefaultAnalysis`
 * is true, the corresponding flag is cleared on every other config in the org
 * inside the same transaction so exactly one default exists per purpose.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { scoring: ['create'] })
  const orgId = session.session.activeOrganizationId

  // Bring-your-own AI key (BYOK) is a Solo-and-above capability. Only creation
  // is gated: a free org that configured a key before the gate existed keeps
  // editing and using it, so this never silently switches anyone's AI off.
  await assertPlanFeature(orgId, 'byok')

  const body = await readValidatedBody(event, createAiConfigSchema.parse)

  const apiKeyEncrypted = encrypt(body.apiKey, env.BETTER_AUTH_SECRET)

  // Auto-promote the very first config to defaults so the org isn't left
  // with a "configured-but-unusable" state.
  const existingCount = await db.$count(aiConfig, eq(aiConfig.organizationId, orgId))
  const isFirst = existingCount === 0
  const isDefaultChatbot = isFirst || body.isDefaultChatbot === true
  const isDefaultAnalysis = isFirst || body.isDefaultAnalysis === true

  const created = await db.transaction(async (tx) => {
    if (isDefaultChatbot) {
      await tx.update(aiConfig)
        .set({ isDefaultChatbot: false })
        .where(eq(aiConfig.organizationId, orgId))
      // The platform engine holds the chatbot slot by default, so it has to
      // yield it too — otherwise it keeps winning resolveChatbotProvider and
      // the user's newly-chosen default never runs.
      await tx.update(platformAiConfig)
        .set({ isDefaultChatbot: false, updatedAt: new Date() })
        .where(eq(platformAiConfig.organizationId, orgId))
    }
    if (isDefaultAnalysis) {
      await tx.update(aiConfig)
        .set({ isDefaultAnalysis: false })
        .where(eq(aiConfig.organizationId, orgId))
      await tx.update(platformAiConfig)
        .set({ isDefaultAnalysis: false, updatedAt: new Date() })
        .where(eq(platformAiConfig.organizationId, orgId))
    }

    const [row] = await tx.insert(aiConfig)
      .values({
        organizationId: orgId,
        name: body.name,
        provider: body.provider,
        model: body.model,
        apiKeyEncrypted,
        baseUrl: body.baseUrl ?? null,
        maxTokens: body.maxTokens,
        inputPricePer1m: body.inputPricePer1m != null ? String(body.inputPricePer1m) : null,
        outputPricePer1m: body.outputPricePer1m != null ? String(body.outputPricePer1m) : null,
        isDefaultChatbot,
        isDefaultAnalysis,
      })
      .returning({
        id: aiConfig.id,
        name: aiConfig.name,
        provider: aiConfig.provider,
        model: aiConfig.model,
        baseUrl: aiConfig.baseUrl,
        maxTokens: aiConfig.maxTokens,
        isDefaultChatbot: aiConfig.isDefaultChatbot,
        isDefaultAnalysis: aiConfig.isDefaultAnalysis,
      })
    return row!
  })

  recordActivity({
    organizationId: orgId,
    actorId: session.user.id,
    action: 'created',
    resourceType: 'aiConfig',
    resourceId: created.id,
  })

  setResponseStatus(event, 201)
  return { config: { ...created, hasApiKey: true } }
})
