import { describe, expect, it } from 'vitest'
import { PLATFORM_ENGINE_ID } from '../../shared/chatbot'
import {
  platformPinUpdate,
  toConversationSummary,
} from '../../server/utils/chatbotConversation'

type ConversationRow = Parameters<typeof toConversationSummary>[0]

function conversationRow(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: 'conversation-1',
    organizationId: 'org-1',
    userId: 'user-1',
    folderId: null,
    agentId: null,
    aiConfigId: null,
    usePlatformAi: true,
    chatbotModel: 'google/gemini-3.6-flash',
    title: 'Hiring plan',
    scope: { kind: 'organization' },
    pinned: false,
    thinking: false,
    lastMessagePreview: null,
    lastMessageAt: null,
    createdAt: new Date('2026-08-08T00:00:00Z'),
    updatedAt: new Date('2026-08-08T00:00:00Z'),
    ...overrides,
  } as ConversationRow
}

describe('chatbot conversation model persistence', () => {
  it('restores a platform model pin in the conversation summary', () => {
    const summary = toConversationSummary(conversationRow())

    expect(summary.aiConfigId).toBe(PLATFORM_ENGINE_ID)
    expect(summary.model).toBe('google/gemini-3.6-flash')
  })

  it('does not expose a stale catalogue pin while a BYOK config is active', () => {
    const summary = toConversationSummary(conversationRow({
      aiConfigId: 'config-1',
      usePlatformAi: false,
    }))

    expect(summary.aiConfigId).toBe('config-1')
    expect(summary.model).toBeNull()
  })

  it('stores the platform sentinel outside the ai_config foreign key', () => {
    expect(platformPinUpdate(PLATFORM_ENGINE_ID)).toEqual({
      aiConfigId: null,
      usePlatformAi: true,
    })
    expect(platformPinUpdate('config-1')).toEqual({
      aiConfigId: 'config-1',
      usePlatformAi: false,
    })
  })
})
