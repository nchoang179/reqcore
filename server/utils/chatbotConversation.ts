/**
 * Wire mapping for chatbot conversations.
 *
 * The engine pinned to a conversation is stored in two columns — `aiConfigId`
 * (a real FK to ai_config) and `usePlatformAi` (the platform engine, which has
 * no ai_config row). The client picker knows only one field: an id, where
 * `'__platform__'` means the platform engine. This flattens the two columns into
 * that one id on the way out, and `platformPinUpdate` splits it back apart on
 * the way in.
 *
 * Every conversation endpoint goes through here so the four projections cannot
 * drift apart.
 */
import type { chatbotConversation } from '../database/schema'
import type { ChatbotConversationSummary, ChatbotScope } from '../../shared/chatbot'
import { PLATFORM_AI_CONFIG_ID } from './ai/platformConfig'

type ConversationRow = typeof chatbotConversation.$inferSelect

export function toConversationSummary(row: ConversationRow): ChatbotConversationSummary {
  return {
    id: row.id,
    title: row.title,
    folderId: row.folderId,
    agentId: row.agentId,
    aiConfigId: row.usePlatformAi ? PLATFORM_AI_CONFIG_ID : row.aiConfigId,
    // The model pin only means anything on the platform engine; hide it on a
    // BYOK conversation so the picker can't show a model that isn't in use.
    model: row.usePlatformAi ? row.chatbotModel : null,
    scope: (row.scope ?? { kind: 'organization' }) as ChatbotScope,
    pinned: row.pinned,
    thinking: row.thinking,
    lastMessagePreview: row.lastMessagePreview,
    lastMessageAt: row.lastMessageAt ? row.lastMessageAt.getTime() : null,
    createdAt: row.createdAt.getTime(),
  }
}

/**
 * Column updates for a picked engine id. Always writes both columns so they can
 * never disagree about which engine is pinned.
 */
export function platformPinUpdate(aiConfigId: string | null): {
  aiConfigId: string | null
  usePlatformAi: boolean
} {
  const picksPlatform = aiConfigId === PLATFORM_AI_CONFIG_ID
  return {
    aiConfigId: picksPlatform ? null : aiConfigId,
    usePlatformAi: picksPlatform,
  }
}

/** True when the id refers to the platform engine rather than an ai_config row. */
export function isPlatformEngineId(aiConfigId: string | null | undefined): boolean {
  return aiConfigId === PLATFORM_AI_CONFIG_ID
}
