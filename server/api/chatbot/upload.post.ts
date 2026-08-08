import { fileTypeFromBuffer } from 'file-type'
import { DocumentLimitError, parseDocumentIsolated } from '../../utils/resume-parser'
import { ChatbotAttachmentQuotaError, saveChatbotAttachment } from '../../utils/chatbotAttachments'
import { readLimitedMultipartFile } from '../../utils/limitedMultipart'
import { requireChatbotAccess } from '../../utils/chatbotAccess'
import { createRateLimiter } from '../../utils/rateLimit'
import {
  CHATBOT_MAX_UPLOAD_BYTES,
  CHATBOT_MAX_STORED_ATTACHMENT_CHARS,
  type ChatbotAttachment,
} from '../../../shared/chatbot'

/**
 * POST /api/chatbot/upload
 *
 * Upload a single file (PDF/DOC/DOCX or plain text), parse it, and stash the
 * extracted text in the per-user attachment store. The attachment id is
 * returned and can be referenced from a subsequent /api/chatbot/chat call.
 *
 * Files never touch S3 — they're held in memory for 30 minutes only.
 */
const limiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
  message: 'Too many uploads. Please wait a moment.',
})

const PARSEABLE_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

export default defineEventHandler(async (event) => {
  await limiter(event)
  const session = await requireChatbotAccess(event)

  const filePart = await readLimitedMultipartFile(event, 'file', CHATBOT_MAX_UPLOAD_BYTES)

  const buf = filePart.data
  const detected = await fileTypeFromBuffer(buf)
  let mime = detected?.mime ?? filePart.type ?? 'application/octet-stream'

  // Plain text fallback: detect by lack of magic bytes + ASCII content.
  if (!detected) {
    const sample = buf.subarray(0, Math.min(buf.length, 512)).toString('utf8')
    // eslint-disable-next-line no-control-regex
    const looksTextual = /^[\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFF]*$/.test(sample)
    if (looksTextual) mime = 'text/plain'
  }

  let text = ''
  if (PARSEABLE_MIME.has(mime)) {
    try {
      const parsed = await parseDocumentIsolated(buf, mime, {
        maxCharacters: CHATBOT_MAX_STORED_ATTACHMENT_CHARS,
      })
      text = parsed?.text ?? ''
    }
    catch (error) {
      if (error instanceof DocumentLimitError) {
        throw createError({ statusCode: 422, statusMessage: error.message })
      }
      throw error
    }
  } else if (mime.startsWith('text/') || mime === 'application/json') {
    text = buf.toString('utf8').slice(0, CHATBOT_MAX_STORED_ATTACHMENT_CHARS)
  } else {
    throw createError({
      statusCode: 415,
      statusMessage: 'Unsupported file type. Use PDF, DOC, DOCX, or plain text.',
    })
  }

  if (!text.trim()) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Could not extract any text from this file.',
    })
  }

  const attachment: ChatbotAttachment = {
    id: crypto.randomUUID(),
    filename: filePart.filename,
    mimeType: mime,
    sizeBytes: buf.length,
    textLength: text.length,
  }

  try {
    saveChatbotAttachment({
      userId: session.user.id,
      orgId: session.session.activeOrganizationId,
      attachment,
      text,
    })
  }
  catch (error) {
    if (error instanceof ChatbotAttachmentQuotaError) {
      throw createError({ statusCode: 413, statusMessage: error.message })
    }
    throw error
  }

  return attachment
})
