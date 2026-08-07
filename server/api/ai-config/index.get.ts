import { eq } from 'drizzle-orm'
import { aiConfig } from '../../database/schema'
import {
  canUsePlatformAi,
  getPlatformAiOverride,
  toPlatformAiConfigListRow,
} from '../../utils/ai/platformConfig'

/**
 * GET /api/ai-config
 *
 * List ALL AI configurations for the active organization, ordered with
 * defaults first then by recency. Never returns the encrypted API key —
 * only a `hasApiKey` boolean.
 */
export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { scoring: ['read'] })
  const orgId = session.session.activeOrganizationId

  const rows = await db.query.aiConfig.findMany({
    where: eq(aiConfig.organizationId, orgId),
    columns: {
      id: true,
      name: true,
      provider: true,
      model: true,
      baseUrl: true,
      maxTokens: true,
      inputPricePer1m: true,
      outputPricePer1m: true,
      isDefaultChatbot: true,
      isDefaultAnalysis: true,
      apiKeyEncrypted: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: (t, { desc }) => [desc(t.isDefaultChatbot), desc(t.isDefaultAnalysis), desc(t.createdAt)],
  })

  const mapped = rows.map(({ apiKeyEncrypted, ...rest }) => ({
    ...rest,
    inputPricePer1m: rest.inputPricePer1m != null ? Number(rest.inputPricePer1m) : null,
    outputPricePer1m: rest.outputPricePer1m != null ? Number(rest.outputPricePer1m) : null,
    hasApiKey: Boolean(apiKeyEncrypted),
    source: 'byok',
  }))

  // The platform ("company") OpenRouter engine is always listed so it can be
  // toggled on or off — it is never removed. Grandfathered orgs are the sole
  // exception: their free access is explicitly BYOK-only, so they never see it.
  if (await canUsePlatformAi(orgId)) {
    const platformOverride = await getPlatformAiOverride(orgId)
    const anyByokAnalysisDefault = mapped.some(c => c.isDefaultAnalysis)
    const anyByokChatbotDefault = mapped.some(c => c.isDefaultChatbot)
    mapped.push(
      toPlatformAiConfigListRow(platformOverride, {
        isDefaultAnalysisFallback: !anyByokAnalysisDefault,
        isDefaultChatbotFallback: !anyByokChatbotDefault,
      }),
    )
  }

  return mapped
})
