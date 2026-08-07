import { defineTask } from 'nitropack/runtime/task'
import { runRetentionCleanup } from '../utils/retention-cleanup'
import { pruneExpiredChatbotConversations } from '../utils/chatbotRetention'

export default defineTask({
  meta: {
    name: 'retention-cleanup',
    description: 'Prune expired chats and erase candidates according to retention policies',
  },
  async run() {
    const chatbotConversationsDeleted = await pruneExpiredChatbotConversations()
    const result = await runRetentionCleanup({ source: 'scheduled_task' })
    return { result: { ...result, chatbotConversationsDeleted } }
  },
})
