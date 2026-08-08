/**
 * Spend ledger writes for non-analysis AI calls (see schema `aiUsageEvent`).
 *
 * The budget gate reads this table, so a missing write is money we can't see:
 * platform-paid turns that never land here are invisible to both the org's
 * credit allowance and the global daily kill-switch. Recording is therefore
 * best-effort but *loud* — a failed write logs at error level rather than
 * passing silently, because the failure mode is an uncapped bill, not a lost
 * metric.
 *
 * Assistant turns are written in two steps, because a turn's cost isn't known
 * until it ends but the allowance has to be defended before it starts:
 *
 *   1. `reserveChatbotUsage` — insert up front with an estimated credit charge.
 *      The gate sums rows, so the reservation is visible to any concurrent turn
 *      immediately. Without this, N simultaneous requests all read the same
 *      pre-spend balance and every one of them passes a gate that only had room
 *      for one, letting an org overdraw past zero.
 *   2. `settleChatbotUsage` — reconcile that row to the real tokens, µ$ and
 *      credits once the stream finishes.
 *
 * Paid turns that produce nothing release their reservation. A hosted Free
 * prompt keeps its row once submitted because its allowance counts prompts,
 * independent of token usage or whether the model completed an answer.
 */
import { and, eq, sql } from 'drizzle-orm'
import { aiUsageEvent } from '../../database/schema'
import { estimatedTurnCredits } from './credits'

export interface ReserveChatbotUsageInput {
  orgId: string
  userId?: string | null
  provider: string
  model: string
  billingMode: 'platform' | 'byok'
  /** Present only for hosted Free workspaces; makes the prompt claim atomic. */
  promptLimit?: number
}

export class ChatbotPromptLimitReachedError extends Error {
  constructor() {
    super('Free assistant prompt limit reached.')
    this.name = 'ChatbotPromptLimitReachedError'
  }
}

export interface SettleChatbotUsageInput {
  promptTokens: number
  completionTokens: number
  /** Null when the model has no price on file — only reachable via BYOK. */
  costUsdMicros: number | null
  /**
   * Null leaves the up-front estimate in place. That happens when a BYOK org
   * runs an unpriced model: it is their bill, so we don't refuse the turn, but
   * we also can't compute a real charge — so the estimate stands rather than
   * silently charging zero. Platform turns never reach this, `assertPricedModel`
   * stops them earlier.
   */
  creditsCharged: number | null
}

/**
 * Claim an estimated charge against the org's allowance before a turn runs. The
 * estimate is scaled to the chosen model (see `estimatedTurnCredits`), so a turn
 * on an expensive model reserves proportionally more.
 *
 * Returns the ledger row id to settle against, or null if the insert failed — in
 * which case the caller proceeds unreserved rather than denying a paying
 * customer service over a ledger hiccup.
 */
export async function reserveChatbotUsage(
  input: ReserveChatbotUsageInput,
): Promise<string | null> {
  const reserved = estimatedTurnCredits(input.model)
  const promptLimit = input.promptLimit
  try {
    if (promptLimit !== undefined) {
      const rowId = await db.transaction(async (tx) => {
        // Serialize claims for one org so simultaneous twentieth prompts cannot
        // both observe 19 and pass. The ledger row itself is the prompt claim.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`chatbot-prompts:${input.orgId}`}))`)
        const [usage] = await tx
          .select({ total: sql<string>`count(*)` })
          .from(aiUsageEvent)
          .where(and(
            eq(aiUsageEvent.organizationId, input.orgId),
            eq(aiUsageEvent.feature, 'chatbot_message'),
          ))
        if (Number(usage?.total ?? 0) >= promptLimit) {
          throw new ChatbotPromptLimitReachedError()
        }

        const [row] = await tx.insert(aiUsageEvent).values({
          organizationId: input.orgId,
          userId: input.userId ?? null,
          feature: 'chatbot_message',
          provider: input.provider,
          model: input.model,
          billingMode: input.billingMode,
          promptTokens: null,
          completionTokens: null,
          costUsdMicros: null,
          creditsCharged: reserved,
        }).returning({ id: aiUsageEvent.id })
        return row?.id ?? null
      })
      return rowId
    }

    const [row] = await db.insert(aiUsageEvent).values({
      organizationId: input.orgId,
      userId: input.userId ?? null,
      feature: 'chatbot_message',
      provider: input.provider,
      model: input.model,
      billingMode: input.billingMode,
      promptTokens: null,
      completionTokens: null,
      costUsdMicros: null,
      creditsCharged: reserved,
    }).returning({ id: aiUsageEvent.id })
    return row?.id ?? null
  }
  catch (err) {
    if (err instanceof ChatbotPromptLimitReachedError) throw err
    console.error(
      `[Reqcore] failed to reserve assistant usage for org ${input.orgId} `
      + `(${input.model}). This turn is invisible to the allowance gate.`,
      err,
    )
    // Free is count-capped. Proceeding without a row would make the prompt
    // invisible and allow more than the advertised lifetime limit.
    if (input.promptLimit !== undefined) throw err
    return null
  }
}

/** Reconcile a reservation to what the turn actually cost. */
export async function settleChatbotUsage(
  rowId: string,
  input: SettleChatbotUsageInput,
): Promise<void> {
  try {
    await db.update(aiUsageEvent)
      .set({
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        costUsdMicros: input.costUsdMicros,
        // Omitted, not nulled, when unknown — nulling would zero the charge.
        ...(input.creditsCharged != null ? { creditsCharged: input.creditsCharged } : {}),
      })
      .where(eq(aiUsageEvent.id, rowId))
  }
  catch (err) {
    // The reservation stands, so we over-charge rather than under-charge. That
    // is the right way round to fail, but it's still a customer-visible error.
    console.error(
      `[Reqcore] failed to settle assistant usage row ${rowId}; `
      + `the up-front estimated charge stands.`,
      err,
    )
  }
}

/** Drop a reservation for a turn that never produced an answer. */
export async function releaseChatbotUsage(rowId: string): Promise<void> {
  try {
    await db.delete(aiUsageEvent).where(eq(aiUsageEvent.id, rowId))
  }
  catch (err) {
    console.error(`[Reqcore] failed to release assistant reservation ${rowId}.`, err)
  }
}
