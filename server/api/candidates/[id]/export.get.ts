/**
 * GET /api/candidates/:id/export
 *
 * Data-subject access export (GDPR Art. 15 / 20). Assembles the candidate's
 * full data graph as a downloadable JSON document. The org is the data
 * controller and is responsible for verifying the requester's identity before
 * sharing this — see DATA-RETENTION.md.
 */
import { eq, and, inArray, or } from 'drizzle-orm'
import {
  activityLog,
  candidate,
  chatbotConversation,
  chatbotMessage,
  chatbotMessageEntityReference,
  comment,
  propertyValue,
} from '../../../database/schema'
import { candidateIdParamSchema } from '../../../utils/schemas/candidate'
import { recordRetentionAudit } from '../../../utils/erasure'

export default defineEventHandler(async (event) => {
  const session = await requirePermission(event, { candidate: ['read'] })
  const orgId = session.session.activeOrganizationId

  const { id } = await getValidatedRouterParams(event, candidateIdParamSchema.parse)

  const record = await db.query.candidate.findFirst({
    where: and(eq(candidate.id, id), eq(candidate.organizationId, orgId)),
    with: {
      documents: true,
      applications: {
        with: {
          job: { columns: { id: true, title: true } },
          responses: true,
          interviews: true,
          criterionScores: true,
          // AI analysis output is personal data under Art. 15 (incl. any
          // automated-decision logic) and must be included in the export.
          analysisRuns: true,
          source: true,
          conversation: {
            columns: {
              id: true,
              applicationId: true,
              lastMessageAt: true,
              createdAt: true,
              updatedAt: true,
            },
            with: { messages: true },
          },
        },
      },
    },
  })

  if (!record) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  const applicationIds = record.applications.map(application => application.id)
  const documentIds = record.documents.map(document => document.id)
  const referenceScopes = [
    and(
      eq(chatbotMessageEntityReference.entityType, 'candidate'),
      eq(chatbotMessageEntityReference.entityId, id),
    ),
    ...(applicationIds.length > 0
      ? [and(
          eq(chatbotMessageEntityReference.entityType, 'application'),
          inArray(chatbotMessageEntityReference.entityId, applicationIds),
        )]
      : []),
    ...(documentIds.length > 0
      ? [and(
          eq(chatbotMessageEntityReference.entityType, 'document'),
          inArray(chatbotMessageEntityReference.entityId, documentIds),
        )]
      : []),
  ]

  const [comments, properties, activity, chatbotReferences] = await Promise.all([
    db.select().from(comment).where(
      and(eq(comment.targetType, 'candidate'), eq(comment.targetId, id), eq(comment.organizationId, orgId)),
    ),
    db.select().from(propertyValue).where(
      and(eq(propertyValue.entityType, 'candidate'), eq(propertyValue.entityId, id), eq(propertyValue.organizationId, orgId)),
    ),
    db.select().from(activityLog).where(
      and(eq(activityLog.resourceType, 'candidate'), eq(activityLog.resourceId, id), eq(activityLog.organizationId, orgId)),
    ),
    db.query.chatbotMessageEntityReference.findMany({
      where: and(
        eq(chatbotMessageEntityReference.organizationId, orgId),
        referenceScopes.length === 1 ? referenceScopes[0]! : or(...referenceScopes),
      ),
      columns: { messageId: true, entityType: true, entityId: true },
    }),
  ])

  const chatbotMessageIds = [...new Set(chatbotReferences.map(reference => reference.messageId))]
  const chatbotRows = chatbotMessageIds.length > 0
    ? await db.select({
        conversationId: chatbotConversation.id,
        conversationTitle: chatbotConversation.title,
        messageId: chatbotMessage.id,
        role: chatbotMessage.role,
        content: chatbotMessage.content,
        reasoning: chatbotMessage.reasoning,
        toolCalls: chatbotMessage.toolCalls,
        sources: chatbotMessage.sources,
        createdAt: chatbotMessage.createdAt,
      })
        .from(chatbotMessage)
        .innerJoin(chatbotConversation, eq(chatbotMessage.conversationId, chatbotConversation.id))
        .where(and(
          eq(chatbotMessage.organizationId, orgId),
          inArray(chatbotMessage.id, chatbotMessageIds),
        ))
    : []

  await recordRetentionAudit(orgId, id, 'exported', 'success', session.user.id, {})

  setHeader(event, 'Content-Type', 'application/json')
  setHeader(event, 'Content-Disposition', `attachment; filename="candidate-${id}-export.json"`)

  return {
    exportedAt: new Date().toISOString(),
    candidate: record,
    comments,
    properties,
    activity,
    chatbotCopies: chatbotRows.map(message => ({
      ...message,
      entityReferences: chatbotReferences
        .filter(reference => reference.messageId === message.messageId)
        .map(({ entityType, entityId }) => ({ entityType, entityId })),
    })),
    // Note: `candidate.documents` lists uploaded-file metadata (name, type,
    // storage key). The file *contents* (CVs, cover letters) are served
    // separately via the document download endpoints and are not inlined here.
    notice: 'Document file contents are available via their individual download links and are not embedded in this JSON.',
  }
})
