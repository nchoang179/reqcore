import { afterEach, describe, expect, it } from 'vitest'
import {
  ChatbotAttachmentQuotaError,
  clearChatbotAttachmentsForUser,
  getChatbotAttachments,
  saveChatbotAttachment,
} from '../../server/utils/chatbotAttachments'
import {
  CHATBOT_MAX_STORED_ATTACHMENT_CHARS,
  CHATBOT_MAX_STORED_BYTES_PER_USER,
} from '../../shared/chatbot'

const orgId = 'org-attachment-test'
const userId = 'user-attachment-test'

afterEach(() => clearChatbotAttachmentsForUser(orgId, userId))

function save(id: string, text: string) {
  saveChatbotAttachment({
    orgId,
    userId,
    attachment: {
      id,
      filename: `${id}.txt`,
      mimeType: 'text/plain',
      sizeBytes: Buffer.byteLength(text),
      textLength: text.length,
    },
    text,
  })
}

describe('chatbot attachment storage limits', () => {
  it('caps extracted text before retaining it', () => {
    save('a', 'x'.repeat(CHATBOT_MAX_STORED_ATTACHMENT_CHARS + 50))
    const [stored] = getChatbotAttachments(orgId, userId, ['a'])
    expect(stored?.text).toHaveLength(CHATBOT_MAX_STORED_ATTACHMENT_CHARS)
    expect(stored?.textLength).toBe(CHATBOT_MAX_STORED_ATTACHMENT_CHARS)
  })

  it('enforces an aggregate per-user UTF-8 byte quota', () => {
    const chunk = 'x'.repeat(CHATBOT_MAX_STORED_ATTACHMENT_CHARS)
    const count = Math.floor(CHATBOT_MAX_STORED_BYTES_PER_USER / Buffer.byteLength(chunk))
    for (let index = 0; index < count; index++) save(`a-${index}`, chunk)
    expect(() => save('over-quota', chunk)).toThrow(ChatbotAttachmentQuotaError)
  })
})
