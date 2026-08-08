/** Durable notification outbox dispatch with leases, retries, and digest grouping. */
import { and, asc, eq, gt, inArray, lte, sql } from 'drizzle-orm'
import { emailSuppression, notificationOutbox } from '../../database/schema/app'
import { sendNotificationEmail } from '../email'
import { renderDigest, renderNotification } from './templates'
import { applicationUrl, dashboardUrl, inboxConversationUrl, interviewUrl } from './urls'
import type { NotificationType } from '~~/shared/notifications'

const MAX_ATTEMPTS = 6
const DEFAULT_BATCH = 50
const LEASE_MS = 10 * 60_000

type OutboxRow = typeof notificationOutbox.$inferSelect
type NotificationDbClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface NotificationDispatchResult {
  enabled: boolean
  source: NotificationDispatchSource
  processed: number
  sent: number
  skipped: number
  retried: number
  dead: number
}

export type NotificationDispatchSource = 'scheduled_task' | 'cron_endpoint' | 'interactive'

function clampBatch(n: number | undefined): number {
  return Math.min(500, Math.max(1, n ?? DEFAULT_BATCH))
}

function backoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 60 * 60_000)
}

function disabledResult(source: NotificationDispatchSource): NotificationDispatchResult {
  return { enabled: false, source, processed: 0, sent: 0, skipped: 0, retried: 0, dead: 0 }
}

function emptyResult(source: NotificationDispatchSource): NotificationDispatchResult {
  return { enabled: true, source, processed: 0, sent: 0, skipped: 0, retried: 0, dead: 0 }
}

function mergeResults(a: NotificationDispatchResult, b: NotificationDispatchResult): NotificationDispatchResult {
  return {
    enabled: a.enabled && b.enabled,
    source: a.source,
    processed: a.processed + b.processed,
    sent: a.sent + b.sent,
    skipped: a.skipped + b.skipped,
    retried: a.retried + b.retried,
    dead: a.dead + b.dead,
  }
}

function rowApplicationUrl(row: OutboxRow): string {
  const payload = row.payload as Record<string, unknown>
  if (row.type === 'interview_response') {
    return interviewUrl(String(payload.interviewId ?? ''))
  }
  if (row.type === 'candidate_replied' && payload.conversationId) {
    return inboxConversationUrl(String(payload.conversationId))
  }
  return applicationUrl(String(payload.applicationId ?? ''))
}

function enrichPayload(row: OutboxRow): Record<string, unknown> {
  const targetUrl = rowApplicationUrl(row)
  return {
    ...(row.payload as Record<string, unknown>),
    applicationUrl: targetUrl,
    interviewUrl: targetUrl,
  }
}

async function isSuppressed(email: string, dbc: NotificationDbClient = db): Promise<boolean> {
  const rows = await dbc.select({ id: emailSuppression.id })
    .from(emailSuppression)
    .where(eq(sql<string>`lower(${emailSuppression.email})`, email.toLowerCase()))
    .limit(1)
  return rows.length > 0
}

async function markSent(id: string, providerMessageId: string | null): Promise<void> {
  await db.update(notificationOutbox)
    .set({ status: 'sent', providerMessageId, sentAt: new Date(), lastError: null, updatedAt: new Date() })
    .where(eq(notificationOutbox.id, id))
}

async function markSkipped(ids: string[], reason: string): Promise<void> {
  if (ids.length === 0) return
  await db.update(notificationOutbox)
    .set({ status: 'skipped', lastError: reason, updatedAt: new Date() })
    .where(inArray(notificationOutbox.id, ids))
}

async function recordFailure(row: OutboxRow, err: unknown): Promise<'dead' | 'retried'> {
  const attempts = row.attempts + 1
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000)
  if (attempts >= MAX_ATTEMPTS) {
    await db.update(notificationOutbox)
      .set({ status: 'dead', attempts, lastError: message, failedAt: new Date(), updatedAt: new Date() })
      .where(eq(notificationOutbox.id, row.id))
    logError('notification.dispatch_dead', { outbox_id: row.id, type: row.type, attempts })
    return 'dead'
  }
  await db.update(notificationOutbox)
    .set({ attempts, nextAttemptAt: new Date(Date.now() + backoffMs(attempts)), lastError: message, updatedAt: new Date() })
    .where(eq(notificationOutbox.id, row.id))
  return 'retried'
}

async function claimInstantRows(batchSize: number, now: Date): Promise<OutboxRow[]> {
  const candidates = await db.select({ id: notificationOutbox.id }).from(notificationOutbox)
    .where(and(
      eq(notificationOutbox.status, 'pending'),
      eq(notificationOutbox.cadence, 'instant'),
      lte(notificationOutbox.nextAttemptAt, now),
    ))
    .orderBy(asc(notificationOutbox.nextAttemptAt))
    .limit(batchSize)

  const claimed: OutboxRow[] = []
  for (const candidate of candidates) {
    const [row] = await db.update(notificationOutbox)
      .set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS), updatedAt: now })
      .where(and(
        eq(notificationOutbox.id, candidate.id),
        eq(notificationOutbox.status, 'pending'),
        lte(notificationOutbox.nextAttemptAt, now),
      ))
      .returning()
    if (row) claimed.push(row)
  }
  return claimed
}

async function dispatchInstant(source: NotificationDispatchSource, batchSize: number): Promise<NotificationDispatchResult> {
  const rows = await claimInstantRows(batchSize, new Date())
  const result = emptyResult(source)
  result.processed = rows.length

  for (const row of rows) {
    if (await isSuppressed(row.recipientEmail)) {
      await markSkipped([row.id], 'email_suppressed')
      result.skipped++
      continue
    }

    const rendered = renderNotification(row.type as NotificationType, enrichPayload(row))
    if (!rendered) {
      await markSkipped([row.id], 'unrenderable_payload')
      result.skipped++
      continue
    }
    try {
      const { providerMessageId } = await sendNotificationEmail({
        to: row.recipientEmail,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        organizationId: row.organizationId,
        type: row.type as NotificationType,
        idempotencyKey: row.id,
      })
      await markSent(row.id, providerMessageId)
      result.sent++
    }
    catch (err) {
      const outcome = await recordFailure(row, err)
      outcome === 'dead' ? result.dead++ : result.retried++
    }
  }
  return result
}

interface DigestGroupKey {
  organizationId: string
  recipientUserId: string
  recipientEmail: string
  digestBucket: string | null
}

async function claimDigestGroup(key: DigestGroupKey, now: Date, retryOnly: boolean): Promise<OutboxRow[]> {
  if (!key.digestBucket) return []
  return db.update(notificationOutbox)
    .set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS), updatedAt: now })
    .where(and(
      eq(notificationOutbox.organizationId, key.organizationId),
      eq(notificationOutbox.recipientUserId, key.recipientUserId),
      eq(notificationOutbox.recipientEmail, key.recipientEmail),
      eq(notificationOutbox.digestBucket, key.digestBucket),
      eq(notificationOutbox.status, 'pending'),
      eq(notificationOutbox.cadence, 'digest'),
      lte(notificationOutbox.nextAttemptAt, now),
      ...(retryOnly ? [gt(notificationOutbox.attempts, 0)] : []),
    ))
    .returning()
}

async function markDigestSent(rows: OutboxRow[], providerMessageId: string | null): Promise<void> {
  const ids = rows.map(row => row.id)
  const leader = rows[0]
  if (!leader) return
  await db.transaction(async (tx) => {
    await tx.update(notificationOutbox)
      .set({ status: 'sent', providerMessageId: null, sentAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(inArray(notificationOutbox.id, ids))
    if (providerMessageId) {
      await tx.update(notificationOutbox)
        .set({ providerMessageId })
        .where(eq(notificationOutbox.id, leader.id))
    }
  })
}

async function dispatchDigest(
  source: NotificationDispatchSource,
  batchSize: number,
  retryOnly: boolean,
): Promise<NotificationDispatchResult> {
  const now = new Date()
  const groups = await db.select({
    organizationId: notificationOutbox.organizationId,
    recipientUserId: notificationOutbox.recipientUserId,
    recipientEmail: notificationOutbox.recipientEmail,
    digestBucket: notificationOutbox.digestBucket,
  }).from(notificationOutbox)
    .where(and(
      eq(notificationOutbox.status, 'pending'),
      eq(notificationOutbox.cadence, 'digest'),
      lte(notificationOutbox.nextAttemptAt, now),
      ...(retryOnly ? [gt(notificationOutbox.attempts, 0)] : []),
    ))
    .groupBy(
      notificationOutbox.organizationId,
      notificationOutbox.recipientUserId,
      notificationOutbox.recipientEmail,
      notificationOutbox.digestBucket,
    )
    .orderBy(asc(notificationOutbox.digestBucket))
    .limit(batchSize)

  const result = emptyResult(source)
  for (const key of groups) {
    const rows = await claimDigestGroup(key, now, retryOnly)
    if (rows.length === 0 || !key.digestBucket) continue
    result.processed += rows.length

    if (await isSuppressed(key.recipientEmail)) {
      await markSkipped(rows.map(row => row.id), 'email_suppressed')
      result.skipped += rows.length
      continue
    }

    const rendered = renderDigest({
      items: rows.map(row => ({
        type: row.type as NotificationType,
        payload: row.payload as Record<string, unknown>,
        applicationUrl: rowApplicationUrl(row),
      })),
      dashboardUrl: dashboardUrl(),
    })
    if (!rendered) {
      await markSkipped(rows.map(row => row.id), 'unrenderable_payload')
      result.skipped += rows.length
      continue
    }
    try {
      const { providerMessageId } = await sendNotificationEmail({
        to: key.recipientEmail,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        organizationId: key.organizationId,
        type: 'digest',
        idempotencyKey: `digest:${key.organizationId}:${key.recipientUserId}:${key.digestBucket}`,
      })
      await markDigestSent(rows, providerMessageId)
      result.sent++
    }
    catch (err) {
      result.retried++
      for (const row of rows) {
        const outcome = await recordFailure(row, err)
        if (outcome === 'dead') result.dead++
      }
    }
  }
  return result
}

export async function runNotificationDispatch(
  options: { source?: NotificationDispatchSource, batchSize?: number } = {},
): Promise<NotificationDispatchResult> {
  const source = options.source ?? 'scheduled_task'
  if (!env.NOTIFICATIONS_ENABLED) {
    logWarn('notification.dispatch_disabled', { source })
    return disabledResult(source)
  }

  const batchSize = clampBatch(options.batchSize)
  const instant = await dispatchInstant(source, batchSize)
  const digestRetries = await dispatchDigest(source, batchSize, true)
  const result = mergeResults(instant, digestRetries)
  logInfo('notification.dispatch_completed', { ...result })
  return result
}

export async function runNotificationDigest(
  options: { source?: NotificationDispatchSource, batchSize?: number } = {},
): Promise<NotificationDispatchResult> {
  const source = options.source ?? 'scheduled_task'
  if (!env.NOTIFICATIONS_ENABLED) {
    logWarn('notification.digest_disabled', { source })
    return disabledResult(source)
  }

  const result = await dispatchDigest(source, clampBatch(options.batchSize ?? 500), false)
  logInfo('notification.digest_completed', { ...result })
  return result
}
