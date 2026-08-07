/**
 * Spend ledger writes for non-analysis AI calls (see schema `aiUsageEvent`).
 *
 * The budget gate reads this table, so a missing write is money we can't see:
 * platform-paid turns that never land here are invisible to both the org's
 * monthly cap and the global daily kill-switch. Recording is therefore
 * best-effort but *loud* — a failed insert logs at error level rather than
 * passing silently, because the failure mode is an uncapped bill, not a lost
 * metric.
 */
import { aiUsageEvent } from '../../database/schema'

export interface RecordAiUsageInput {
  orgId: string
  userId?: string | null
  feature: 'chatbot_message'
  provider: string
  model: string
  billingMode: 'platform' | 'byok'
  promptTokens?: number | null
  completionTokens?: number | null
  costUsdMicros?: number | null
}

export async function recordAiUsage(input: RecordAiUsageInput): Promise<void> {
  try {
    await db.insert(aiUsageEvent).values({
      organizationId: input.orgId,
      userId: input.userId ?? null,
      feature: input.feature,
      provider: input.provider,
      model: input.model,
      billingMode: input.billingMode,
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      costUsdMicros: input.costUsdMicros ?? null,
    })
  }
  catch (err) {
    console.error(
      `[Reqcore] failed to record ${input.billingMode} AI usage for org ${input.orgId} ` +
        `(${input.feature}, ${input.model}). This spend is invisible to the budget gate.`,
      err,
    )
  }
}
