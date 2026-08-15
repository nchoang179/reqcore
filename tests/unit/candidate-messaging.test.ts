import { describe, expect, it } from 'vitest'
import {
  appendReference,
  candidateReplyAddress,
  emailDomain,
  findReplyToken,
  inboundTextContent,
  isDedicatedReplyDomain,
  isKnownConversationSender,
  normalizeEmailAddress,
  parseReferences,
  replySubject,
} from '../../ee/server/utils/candidate-messaging'
import { candidateInboxQuerySchema, sendCandidateMessageSchema } from '../../ee/server/utils/schemas/candidate-message'
import { candidateMessageReplyHint, formatCandidateMessageSender } from '../../server/utils/email'
import { envSchema } from '../../server/utils/env'
import { candidateMessageAllowanceFromUsage } from '../../ee/server/utils/candidate-message-allowance'
import {
  CandidateMessageAttachmentError,
  shouldStoreInboundAttachment,
  validateCandidateMessageAttachments,
} from '../../ee/server/utils/candidate-message-attachments'
import { CANDIDATE_MESSAGE_MAX_ATTACHMENTS } from '../../shared/candidate-messaging'
import {
  conversationCapStartFor,
  GRANDFATHERED_CONVERSATION_CAP_START,
} from '../../shared/billing'

const token = '0123456789abcdef0123456789abcdef'

describe('candidate message allowance', () => {
  it('gates only outbound Free messages at the lifetime limit', () => {
    expect(candidateMessageAllowanceFromUsage('free', 4)).toMatchObject({
      used: 4,
      limit: 5,
      remaining: 1,
      canSend: true,
    })
    expect(candidateMessageAllowanceFromUsage('free', 5)).toMatchObject({
      used: 5,
      limit: 5,
      remaining: 0,
      canSend: false,
    })
  })

  it('keeps paid plans unlimited', () => {
    expect(candidateMessageAllowanceFromUsage('solo', 500)).toEqual({
      tier: 'solo',
      used: 500,
      limit: null,
      remaining: null,
      canSend: true,
    })
  })

  it('applies the same cap to grandfathered orgs', () => {
    expect(candidateMessageAllowanceFromUsage('grandfathered', 5)).toMatchObject({
      limit: 5,
      remaining: 0,
      canSend: false,
    })
  })

  it('counts grandfathered conversations only from the cutoff, not all-time', () => {
    // The tier had unlimited messaging before the cap was extended to it, so an
    // all-time count would have blocked its long-standing orgs on deploy day.
    expect(conversationCapStartFor('grandfathered')).toEqual(GRANDFATHERED_CONVERSATION_CAP_START)
    expect(conversationCapStartFor('free')).toBeNull()
    expect(conversationCapStartFor('solo')).toBeNull()
  })
})

describe('candidate message reply routing', () => {
  it('builds and parses a conversation-specific reply address', () => {
    const address = candidateReplyAddress(token, 'Reply.Reqcore.com')
    expect(address).toBe(`reply-${token}@reply.reqcore.com`)
    expect(findReplyToken([address], 'reply.reqcore.com')).toBe(token)
  })

  it('accepts display-name addresses but requires the exact inbound domain', () => {
    expect(findReplyToken([`Reqcore <reply-${token}@reply.reqcore.com>`], 'reply.reqcore.com')).toBe(token)
    expect(findReplyToken([`reply-${token}@evilreply.reqcore.com`], 'reply.reqcore.com')).toBeNull()
    expect(findReplyToken([`reply-${token}@reply.reqcore.com.evil.test`], 'reply.reqcore.com')).toBeNull()
  })

  it('requires a receiving domain separate from the sender mailbox domain', () => {
    expect(isDedicatedReplyDomain('Reqcore <noreply@reqcore.com>', 'reqcore.com')).toBe(false)
    expect(isDedicatedReplyDomain('Reqcore <noreply@reqcore.com>', 'reply.reqcore.com')).toBe(true)
  })

  it('rejects malformed and short tokens', () => {
    expect(findReplyToken(['reply-not-a-token@reply.reqcore.com'], 'reply.reqcore.com')).toBeNull()
    expect(findReplyToken(['reply-0123@reply.reqcore.com'], 'reply.reqcore.com')).toBeNull()
  })
})

describe('inbound sender recognition', () => {
  const current = 'alice@new.test'

  it('accepts the candidate current address regardless of casing or display name', () => {
    expect(isKnownConversationSender('Alice <ALICE@New.test>', [current])).toBe(true)
  })

  it('accepts a reply from the address an earlier message was sent to', () => {
    // The candidate record was edited to `current` after the invitation went
    // out, so the candidate replies from the address that received it.
    expect(isKnownConversationSender('alice@old.test', [current, 'alice@old.test'])).toBe(true)
  })

  it('rejects an address the conversation has never corresponded with', () => {
    expect(isKnownConversationSender('stranger@example.test', [current, 'alice@old.test'])).toBe(false)
  })

  it('ignores missing history entries instead of matching on them', () => {
    expect(isKnownConversationSender('alice@new.test', [null, undefined, current])).toBe(true)
    expect(isKnownConversationSender('', [null, current])).toBe(false)
  })
})

describe('candidate message content and threading', () => {
  it('identifies the recruiter while keeping the configured sender mailbox', () => {
    expect(formatCandidateMessageSender(
      'Joachim Kolle',
      'Reqcore Messages <messages@reqcore.com>',
    )).toBe('Joachim Kolle <messages@reqcore.com>')
    expect(candidateMessageReplyHint('Joachim Kolle'))
      .toBe('Reply directly to this email to respond to Joachim Kolle.')
  })

  it('removes header control characters from recruiter display names', () => {
    expect(formatCandidateMessageSender(
      'Joachim\r\n<spoofed@example.com>',
      'messages@reqcore.com',
    )).toBe('Joachim spoofed@example.com <messages@reqcore.com>')
  })

  it('normalizes mailbox display names and casing', () => {
    expect(normalizeEmailAddress('Candidate Name <Candidate@Example.COM>')).toBe('candidate@example.com')
    expect(emailDomain('Candidate Name <Candidate@Example.COM>')).toBe('example.com')
    expect(emailDomain('not-an-address')).toBeNull()
  })

  it('deduplicates RFC message references in order', () => {
    const parsed = parseReferences('<one@example> <two@example>')
    expect(appendReference(parsed, '<two@example>')).toEqual(['<one@example>', '<two@example>'])
    expect(appendReference(parsed, '<three@example>')).toEqual([
      '<one@example>', '<two@example>', '<three@example>',
    ])
  })

  it('strips common quoted reply blocks from plain text', () => {
    const text = [
      'Tuesday at 10 works for me.',
      '',
      'On Tue, Jul 14, 2026 at 09:00 Recruiter wrote:',
      '> Can you meet Tuesday?',
    ].join('\n')
    expect(inboundTextContent(text, null)).toBe('Tuesday at 10 works for me.')
  })

  it('strips Gmail quote markers wrapped before wrote', () => {
    const text = [
      'Another test2',
      '',
      'On Thu, Jul 16, 2026 at 2:06 PM messaging1f fee <messages@reqcore.com>',
      'wrote:',
      '> Original message',
    ].join('\n')
    expect(inboundTextContent(text, null)).toBe('Another test2')
  })

  it('converts HTML-only inbound messages to safe text', () => {
    expect(inboundTextContent(null, '<p>Hello <strong>team</strong>.</p><script>alert(1)</script>'))
      .toBe('Hello team.')
  })

  it('keeps an existing reply prefix', () => {
    expect(replySubject('Interview availability')).toBe('Re: Interview availability')
    expect(replySubject('RE: Interview availability')).toBe('RE: Interview availability')
  })
})

describe('candidate message validation and configuration', () => {
  it('requires a stable UUID request ID and non-empty text', () => {
    const valid = {
      applicationId: '550e8400-e29b-41d4-a716-446655440000',
      requestId: '9f8c100d-bca3-4f96-a5da-3ed447b0cc0a',
      subject: 'Interview availability',
      body: 'Are you available Tuesday?',
    }
    expect(sendCandidateMessageSchema.safeParse(valid).success).toBe(true)
    expect(sendCandidateMessageSchema.safeParse({ ...valid, requestId: 'retry-1' }).success).toBe(false)
    expect(sendCandidateMessageSchema.safeParse({ ...valid, body: '   ' }).success).toBe(false)
  })

  it('accepts an application-scoped inbox query', () => {
    const result = candidateInboxQuerySchema.safeParse({
      applicationId: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(result.success).toBe(true)
    expect(candidateInboxQuerySchema.safeParse({ applicationId: 'not-an-id' }).success).toBe(false)
  })

  it('accepts a job-scoped inbox query', () => {
    const result = candidateInboxQuerySchema.safeParse({
      jobId: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(result.success).toBe(true)
    expect(candidateInboxQuerySchema.safeParse({ jobId: 'not-an-id' }).success).toBe(false)
  })

  it('accepts a receiving domain without a protocol and a strong webhook secret', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
      BETTER_AUTH_SECRET: 'a'.repeat(32),
      BETTER_AUTH_URL: 'https://app.example.com',
      S3_ENDPOINT: 'https://s3.example.com',
      S3_ACCESS_KEY: 'key',
      S3_SECRET_KEY: 'secret',
      S3_BUCKET: 'bucket',
      RESEND_REPLY_DOMAIN: 'reply.example.com',
      RESEND_RECEIVING_API_KEY: 're_receiving_full_access',
      RESEND_WEBHOOK_SECRET: 'whsec_1234567890123456',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a receiving URL because MX routing requires a domain', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
      BETTER_AUTH_SECRET: 'a'.repeat(32),
      BETTER_AUTH_URL: 'https://app.example.com',
      S3_ENDPOINT: 'https://s3.example.com',
      S3_ACCESS_KEY: 'key',
      S3_SECRET_KEY: 'secret',
      S3_BUCKET: 'bucket',
      RESEND_REPLY_DOMAIN: 'https://reply.example.com',
    })
    expect(result.success).toBe(false)
  })
})

describe('candidate message attachments', () => {
  it('accepts a PDF based on its bytes and sanitizes its filename', async () => {
    const [file] = await validateCandidateMessageAttachments([{
      data: Buffer.from('%PDF-1.7\n% test document'),
      filename: '../offer<final>.pdf',
    }])

    expect(file).toMatchObject({
      filename: '_offer_final_.pdf',
      mimeType: 'application/pdf',
      extension: 'pdf',
    })
  })

  it('rejects unsupported content even when the filename looks safe', async () => {
    await expect(validateCandidateMessageAttachments([{
      data: Buffer.from('not actually a PDF'),
      filename: 'offer.pdf',
    }])).rejects.toBeInstanceOf(CandidateMessageAttachmentError)
  })

  it('enforces the attachment count before processing file contents', async () => {
    const files = Array.from({ length: CANDIDATE_MESSAGE_MAX_ATTACHMENTS + 1 }, (_, index) => ({
      data: Buffer.from(`file-${index}`),
      filename: `file-${index}.pdf`,
    }))
    await expect(validateCandidateMessageAttachments(files)).rejects.toThrow('Attach at most 5 files.')
  })

  it('ignores embedded signature images but keeps ordinary attachments', () => {
    expect(shouldStoreInboundAttachment({ contentDisposition: 'inline', contentId: 'signature-logo' })).toBe(false)
    expect(shouldStoreInboundAttachment({ contentDisposition: 'attachment', contentId: null })).toBe(true)
    expect(shouldStoreInboundAttachment({ contentDisposition: 'inline', contentId: null })).toBe(true)
  })
})
