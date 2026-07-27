import { Resend } from 'resend'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { escapeHtml, renderNotificationLayout } from './notifications/templates'
import type { NotificationType } from '~~/shared/notifications'

// ─── Resend client ────────────────────────────────────────────────────────────

let _resend: Resend | undefined
let _resendReceiving: Resend | undefined

export function getResendClient(): Resend | null {
  const apiKey = env.RESEND_API_KEY
  if (!apiKey) return null
  if (!_resend) _resend = new Resend(apiKey)
  return _resend
}

export function getResendReceivingClient(): Resend | null {
  const apiKey = env.RESEND_RECEIVING_API_KEY
  if (!apiKey) return null
  if (!_resendReceiving) _resendReceiving = new Resend(apiKey)
  return _resendReceiving
}

// ─── SMTP transporter ─────────────────────────────────────────────────────────

let _smtp: Transporter | undefined

function getSmtpTransporter(): Transporter | null {
  if (!env.SMTP_HOST) return null
  if (!_smtp) {
    _smtp = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      ...(env.SMTP_USER && env.SMTP_PASS
        ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }
        : {}),
    })
  }
  return _smtp
}

/**
 * Returns the configured sender address for the active email provider.
 * SMTP uses SMTP_FROM; Resend uses RESEND_FROM_EMAIL.
 * Exported for use in routes that need the organizer address (e.g. ICS generation).
 */
export function getFromEmail(): string {
  return env.SMTP_HOST ? env.SMTP_FROM : env.RESEND_FROM_EMAIL
}

// ─── Internal unified send helper ────────────────────────────────────────────

interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
  /** Optional .ics binary attachment (calendar invite). */
  icsAttachment?: Buffer
  /** Resend-only metadata tags — silently ignored by SMTP. */
  resendTags?: Array<{ name: string; value: string }>
  /** Resend-only idempotency key — dedupes retried sends at the provider. */
  idempotencyKey?: string
  /** Message logged to console when no provider is configured (dev fallback). */
  logFallback: string
  /** logError category used on transport failure. */
  errorCategory: string
}

/** Outcome of a transport send. `providerMessageId` is Resend-only (null for SMTP/console). */
export interface SendEmailResult {
  providerMessageId: string | null
}

/**
 * Domains reserved by RFC 2606 / RFC 6761 that can never accept mail.
 *
 * The sample applicants behind "Create a test job" live at @example.com, and a
 * recruiter trying the product out will quite reasonably invite one of them to
 * an interview. Nothing about that is a mistake — but actually attempting the
 * send would post a message guaranteed to hard bounce, and hard bounces are
 * scored against the *sending domain*, so every fictional invitation would cost
 * a little deliverability for the real candidate emails that matter.
 *
 * Blocked at the transport rather than in the interview flow so it also covers
 * every other path that might mail a candidate, including ones added later.
 * These domains are reserved precisely so they can never belong to a real user,
 * so this can never swallow a message someone was waiting for.
 */
const UNDELIVERABLE_DOMAINS = ['example.com', 'example.org', 'example.net', 'localhost']
const UNDELIVERABLE_TLDS = ['.test', '.invalid', '.localhost', '.example']

export function isUndeliverableAddress(address: string): boolean {
  const domain = address.trim().toLowerCase().split('@').pop() ?? ''
  if (!domain) return false
  return UNDELIVERABLE_DOMAINS.includes(domain)
    || UNDELIVERABLE_TLDS.some(tld => domain.endsWith(tld))
}

/**
 * Route an outbound email through SMTP (preferred) → Resend → console fallback.
 * Priority: SMTP_HOST set → use SMTP. Else RESEND_API_KEY set → use Resend.
 * Otherwise logs the fallback message and returns (no error thrown).
 * Throws on transport errors so callers can decide whether to swallow them.
 * Returns the Resend message id when available so callers can track delivery.
 */
async function sendEmail(msg: EmailMessage): Promise<SendEmailResult> {
  const from = getFromEmail()

  // Treated as a successful no-op rather than an error: the caller is doing
  // something legitimate, and failing their interview invitation would make
  // the walkthrough look broken.
  if (isUndeliverableAddress(msg.to)) {
    console.info(`[Reqcore] Skipped send to reserved address ${msg.to} — ${msg.subject}`)
    return { providerMessageId: null }
  }

  // 1. SMTP — takes priority when SMTP_HOST is configured
  const smtp = getSmtpTransporter()
  if (smtp) {
    try {
      await smtp.sendMail({
        from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(msg.icsAttachment
          ? { attachments: [{ filename: 'interview.ics', content: msg.icsAttachment, contentType: 'text/calendar; method=REQUEST' }] }
          : {}),
      })
    }
    catch (err) {
      logError(msg.errorCategory, {
        provider: 'smtp',
        error_message: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
    return { providerMessageId: null }
  }

  // 2. Resend
  const resend = getResendClient()
  if (resend) {
    const resendAttachments = msg.icsAttachment
      ? [{ filename: 'interview.ics', content: msg.icsAttachment.toString('base64'), content_type: 'text/calendar; method=REQUEST' }]
      : undefined

    const { data, error } = await resend.emails.send({
      from,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      ...(resendAttachments ? { attachments: resendAttachments } : {}),
      ...(msg.resendTags ? { tags: msg.resendTags } : {}),
    }, msg.idempotencyKey ? { idempotencyKey: msg.idempotencyKey } : undefined)

    if (error) {
      logError(msg.errorCategory, {
        provider: 'resend',
        error_message: error.message,
      })
      throw new Error(error.message)
    }
    return { providerMessageId: data?.id ?? null }
  }

  // 3. No provider configured — dev/test fallback
  console.info(`[Reqcore] ${msg.logFallback}`)
  return { providerMessageId: null }
}

/**
 * Send a recruiter notification email. Routes through the shared `sendEmail`
 * transport (SMTP → Resend → console), tagging it `category: notification` so
 * the Resend delivery webhook can map events back to the outbox, and passing the
 * outbox row id as the Resend idempotency key to make retried sends safe.
 * Returns the provider message id for the worker to persist.
 */
export async function sendNotificationEmail(msg: {
  to: string
  subject: string
  html: string
  text: string
  organizationId: string
  /** Resend `type` tag — an event type, or `digest` for the daily roll-up. */
  type: NotificationType | 'digest'
  idempotencyKey: string
}): Promise<SendEmailResult> {
  return sendEmail({
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    idempotencyKey: msg.idempotencyKey,
    resendTags: [
      { name: 'category', value: 'notification' },
      { name: 'organization', value: msg.organizationId },
      { name: 'type', value: msg.type },
    ],
    logFallback: `Notification email (${msg.type}) → ${msg.to} | ${msg.subject}`,
    errorCategory: 'email.notification_send_failed',
  })
}

export interface CandidateMessageEmailResult {
  id: string
  from: string
}

function safeEmailDisplayName(value: string): string {
  return value.replace(/[\r\n<>"]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function formatCandidateMessageSender(senderName: string, configuredFrom: string): string {
  const mailbox = configuredFrom.match(/<([^<>]+)>/)?.[1] ?? configuredFrom
  const name = safeEmailDisplayName(senderName) || 'Recruiter'
  return `${name} <${mailbox.trim()}>`
}

export function candidateMessageReplyHint(senderName: string): string {
  const name = safeEmailDisplayName(senderName)
  return name
    ? `Reply directly to this email to respond to ${name}.`
    : 'Reply directly to this email to continue the conversation.'
}

/**
 * Candidate conversations are deliberately Resend-only. Arbitrary SMTP cannot
 * provide the inbound routing, signed events, and provider identities required
 * to make a two-way inbox dependable.
 */
export async function sendCandidateMessageEmail(params: {
  to: string
  subject: string
  text: string
  replyTo: string
  senderName: string
  idempotencyKey: string
  inReplyTo?: string | null
  references?: string[] | null
  organizationId: string
  conversationId: string
  messageId: string
  actionLinks?: Array<{ label: string, url: string, emphasis?: boolean }>
  attachments?: Array<{ filename: string, content: string, contentType: string }>
}): Promise<CandidateMessageEmailResult> {
  const resend = getResendClient()
  if (!resend) throw new Error('Candidate messaging requires RESEND_API_KEY')

  const headers: Record<string, string> = {}
  if (params.inReplyTo) headers['In-Reply-To'] = params.inReplyTo
  if (params.references?.length) headers.References = params.references.join(' ')

  const from = formatCandidateMessageSender(params.senderName, env.RESEND_CANDIDATE_FROM_EMAIL)
  const replyHint = candidateMessageReplyHint(params.senderName)
  const actionsHtml = params.actionLinks?.length
    ? `<div style="margin:0 0 20px;text-align:left">${params.actionLinks.map(action => (
        `<a href="${escapeHtml(action.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin:0 8px 0 0;padding:12px 20px;border-radius:6px;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;line-height:1.2;font-weight:600;${action.emphasis ? 'background:#2563eb;color:#fff' : 'border:1px solid #d4d4d8;color:#27272a'}">${escapeHtml(action.label)}</a>`
      )).join('')}</div>`
    : ''
  const actionsText = params.actionLinks?.length
    ? params.actionLinks.map(action => `${action.label}: ${action.url}`).join('\n')
    : ''
  const { data, error } = await resend.emails.send({
    from,
    to: [params.to],
    subject: params.subject,
    text: [actionsText, params.text, replyHint].filter(Boolean).join('\n\n'),
    html: [
      actionsHtml,
      `<div style="white-space:pre-wrap;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#18181b">${escapeHtml(params.text)}</div>`,
      `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e4e4e7;font-family:Arial,sans-serif;font-size:13px;line-height:1.5;color:#71717a">${escapeHtml(replyHint)}</p>`,
    ].join(''),
    replyTo: params.replyTo,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(params.attachments?.length ? { attachments: params.attachments } : {}),
    tags: [
      { name: 'category', value: 'candidate-message' },
      { name: 'organization', value: params.organizationId },
      { name: 'conversation', value: params.conversationId },
      { name: 'message', value: params.messageId },
    ],
  }, { idempotencyKey: params.idempotencyKey })

  if (error || !data?.id) {
    throw new Error(error?.message ?? 'Resend did not return a message ID')
  }

  return { id: data.id, from }
}

// ─── Public send functions ────────────────────────────────────────────────────

/**
 * Send an email verification link.
 * Called by Better Auth after signup and for user-requested resends.
 * Not awaited by the caller (fire-and-forget) to prevent timing attacks.
 */
export async function sendVerificationEmail(data: {
  user: { email: string; name: string }
  url: string
  token: string
}): Promise<void> {
  try {
    await sendEmail({
      to: data.user.email,
      subject: 'Verify your email address — Reqcore',
      html: buildVerificationHtml({ url: data.url }),
      text: buildVerificationText({ url: data.url }),
      resendTags: [{ name: 'category', value: 'verification' }],
      logFallback: 'Verification email suppressed — no email provider configured (set SMTP_HOST or RESEND_API_KEY)',
      errorCategory: 'email.verification_send_failed',
    })
  }
  catch {
    // fire-and-forget — error already logged inside sendEmail
  }
}

/**
 * Send a password reset link.
 * Called by Better Auth when sendResetPassword is configured.
 * Not awaited by the caller (fire-and-forget) to prevent timing attacks.
 */
export async function sendPasswordResetEmail(data: {
  user: { email: string; name: string }
  url: string
  token: string
}): Promise<void> {
  try {
    await sendEmail({
      to: data.user.email,
      subject: 'Reset your password — Reqcore',
      html: buildPasswordResetHtml({ url: data.url }),
      text: buildPasswordResetText({ url: data.url }),
      resendTags: [{ name: 'category', value: 'password-reset' }],
      logFallback: 'Password reset email suppressed — no email provider configured (set SMTP_HOST or RESEND_API_KEY)',
      errorCategory: 'email.password_reset_send_failed',
    })
  }
  catch {
    // fire-and-forget — error already logged inside sendEmail
  }
}

/**
 * Send an organization invitation email.
 * Falls back to console.info when no email provider is configured.
 */
export async function sendOrgInvitationEmail(data: {
  id: string
  email: string
  inviter: { user: { name: string; email: string } }
  organization: { name: string }
  role: string
}, inviteLink: string): Promise<void> {
  await sendEmail({
    to: data.email,
    subject: `You're invited to join ${data.organization.name} on Reqcore`,
    html: buildInvitationHtml({
      inviteeName: data.email,
      inviterName: data.inviter.user.name,
      inviterEmail: data.inviter.user.email,
      organizationName: data.organization.name,
      role: data.role,
      inviteLink,
    }),
    text: buildInvitationText({
      inviterName: data.inviter.user.name,
      organizationName: data.organization.name,
      role: data.role,
      inviteLink,
    }),
    resendTags: [
      { name: 'category', value: 'invitation' },
      { name: 'organization', value: data.organization.name.slice(0, 256).replace(/[^a-zA-Z0-9_-]/g, '_') },
    ],
    logFallback:
      `Invitation email → ${data.email} | ` +
      `Invited by ${data.inviter.user.name} (${data.inviter.user.email}) | ` +
      `Org: ${data.organization.name} | ` +
      `Role: ${data.role} | ` +
      `Link: ${inviteLink}`,
    errorCategory: 'email.invitation_send_failed',
  })
}

// ─────────────────────────────────────────────
// Email templates
// ─────────────────────────────────────────────

function buildInvitationHtml(params: {
  inviteeName: string
  inviterName: string
  inviterEmail: string
  organizationName: string
  role: string
  inviteLink: string
}): string {
  const { inviterName, organizationName, role, inviteLink } = params

  return renderNotificationLayout({
    title: `You're invited to ${organizationName}`,
    heading: "You've been invited",
    bodyHtml:
      `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3f3f46;">`
      + `<strong>${escapeHtml(inviterName)}</strong> has invited you to join `
      + `<strong>${escapeHtml(organizationName)}</strong> as a <strong>${escapeHtml(role)}</strong>.</p>`
      + `<p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#3f3f46;">`
      + `Click the button below to accept the invitation. You'll need to sign in or create an account first.</p>`,
    cta: { label: 'Accept Invitation', url: inviteLink },
    note: "This invitation expires in 48 hours. If you didn't expect this email, you can safely ignore it.",
  })
}

function buildInvitationText(params: {
  inviterName: string
  organizationName: string
  role: string
  inviteLink: string
}): string {
  return [
    `You've been invited to join ${params.organizationName}`,
    '',
    `${params.inviterName} has invited you to join ${params.organizationName} as a ${params.role}.`,
    '',
    'Accept the invitation by visiting the link below:',
    params.inviteLink,
    '',
    'This invitation expires in 48 hours.',
    'If you didn\'t expect this email, you can safely ignore it.',
    '',
    '— Reqcore',
  ].join('\n')
}

// ─────────────────────────────────────────────
// Email verification & password reset templates
// ─────────────────────────────────────────────

function buildVerificationHtml(params: { url: string }): string {
  return renderNotificationLayout({
    title: 'Verify your email',
    heading: 'Verify your email',
    bodyHtml:
      `<p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#3f3f46;">`
      + `Click the button below to verify your email address and activate your account.</p>`,
    cta: { label: 'Verify Email', url: params.url },
    note: "If you didn't create an account, you can safely ignore this email.",
  })
}

function buildVerificationText(params: { url: string }): string {
  return [
    'Verify your email address',
    '',
    'Click the link below to verify your email and activate your Reqcore account:',
    params.url,
    '',
    'If you didn\'t create an account, you can safely ignore this email.',
    '',
    '— Reqcore',
  ].join('\n')
}

function buildPasswordResetHtml(params: { url: string }): string {
  return renderNotificationLayout({
    title: 'Reset your password',
    heading: 'Reset your password',
    bodyHtml:
      `<p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#3f3f46;">`
      + `Click the button below to reset your password. This link will expire shortly.</p>`,
    cta: { label: 'Reset Password', url: params.url },
    note: "If you didn't request a password reset, you can safely ignore this email.",
  })
}

function buildPasswordResetText(params: { url: string }): string {
  return [
    'Reset your password',
    '',
    'Click the link below to reset your Reqcore password:',
    params.url,
    '',
    'If you didn\'t request this, you can safely ignore this email.',
    '',
    '— Reqcore',
  ].join('\n')
}

// ─────────────────────────────────────────────
// Interview invitation emails
// ─────────────────────────────────────────────

export interface InterviewEmailData {
  candidateName: string
  candidateFirstName: string
  candidateLastName: string
  candidateEmail: string
  jobTitle: string
  interviewTitle: string
  interviewDate: string
  interviewTime: string
  interviewDuration: number
  interviewType: string
  interviewLocation: string | null
  interviewers: string[] | null
  organizationName: string
  /** Candidate response URL (omitted = no response link) */
  responseUrl?: string
  /** iCalendar (.ics) file content to attach */
  icsContent?: string
}

/**
 * Replace {{variable}} placeholders in a template string with actual values.
 * Only replaces known variables to prevent injection of unexpected content.
 */
export function renderTemplate(template: string, data: InterviewEmailData): string {
  const variables: Record<string, string> = {
    candidateName: data.candidateName,
    candidateFirstName: data.candidateFirstName,
    candidateLastName: data.candidateLastName,
    candidateEmail: data.candidateEmail,
    jobTitle: data.jobTitle,
    interviewTitle: data.interviewTitle,
    interviewDate: data.interviewDate,
    interviewTime: data.interviewTime,
    interviewDuration: String(data.interviewDuration),
    interviewType: data.interviewType,
    interviewLocation: data.interviewLocation ?? 'To be confirmed',
    interviewers: data.interviewers?.join(', ') ?? 'To be confirmed',
    organizationName: data.organizationName,
  }

  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return key in variables ? variables[key]! : match
  })
}

/**
 * Send an interview invitation email to a candidate.
 * Includes an .ics calendar attachment and response links when provided.
 * Falls back to console.info when no email provider is configured.
 */
export async function sendInterviewInvitationEmail(params: {
  subject: string
  body: string
  data: InterviewEmailData
}): Promise<void> {
  const renderedSubject = renderTemplate(params.subject, params.data)
  const renderedBody = renderTemplate(params.body, params.data)

  const icsBuffer = params.data.icsContent ? Buffer.from(params.data.icsContent) : undefined

  await sendEmail({
    to: params.data.candidateEmail,
    subject: renderedSubject,
    html: buildInterviewInvitationHtml(renderedSubject, renderedBody, params.data),
    text: buildInterviewInvitationText(renderedBody, params.data.responseUrl),
    icsAttachment: icsBuffer,
    resendTags: [
      { name: 'category', value: 'interview-invitation' },
      { name: 'interview', value: params.data.interviewTitle.slice(0, 256).replace(/[^a-zA-Z0-9_-]/g, '_') },
    ],
    logFallback:
      `Interview invitation email → ${params.data.candidateEmail} | ` +
      `Subject: ${renderedSubject} | ` +
      `Interview: ${params.data.interviewTitle} | ` +
      `Date: ${params.data.interviewDate} at ${params.data.interviewTime}` +
      (params.data.icsContent ? ' | .ics attached' : '') +
      (params.data.responseUrl ? ' | response link included' : ''),
    errorCategory: 'email.interview_invitation_send_failed',
  })
}

function buildInterviewInvitationHtml(subject: string, bodyText: string, data: InterviewEmailData): string {
  const bodyHtml = escapeHtml(bodyText).replace(/\n/g, '<br />')

  // Build response buttons HTML when URLs are available
  const responseButtonsHtml = data.responseUrl
    ? `
          <!-- Response Buttons -->
          <tr>
            <td style="padding:0 32px 32px;">
              <div style="border-top:1px solid #e4e4e7;padding-top:24px;">
                <p style="margin:0 0 16px;font-size:14px;font-weight:600;color:#09090b;text-align:center;">
                  Please respond to this invitation
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center">
                      <table role="presentation" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="padding:0 4px;">
                            <a href="${escapeHtml(data.responseUrl)}" target="_blank" rel="noopener noreferrer"
                               style="display:inline-block;padding:11px 20px;background-color:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;border-radius:6px;line-height:1;">
                              Respond to invitation
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
          <!-- Header -->
          <tr>
            <td style="padding:32px 32px 24px;text-align:center;border-bottom:1px solid #f4f4f5;">
              <h1 style="margin:0;font-size:20px;font-weight:600;color:#09090b;">${escapeHtml(data.organizationName)}</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <div style="font-size:14px;line-height:1.7;color:#3f3f46;">
                ${bodyHtml}
              </div>
            </td>
          </tr>${responseButtonsHtml}
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;text-align:center;border-top:1px solid #f4f4f5;background-color:#fafafa;">
              <p style="margin:0;font-size:12px;color:#a1a1aa;">
                Sent by ${escapeHtml(data.organizationName)} via Reqcore
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Build plain-text email body with response links appended.
 */
function buildInterviewInvitationText(
  renderedBody: string,
  responseUrl?: InterviewEmailData['responseUrl'],
): string {
  if (!responseUrl) return renderedBody

  return [
    renderedBody,
    '',
    '─────────────────────────────',
    `Respond to invitation: ${responseUrl}`,
    '',
    '─────────────────────────────',
  ].join('\n')
}
