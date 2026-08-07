import { eq } from 'drizzle-orm'
import { document } from '../database/schema'
import { parseDocumentSafelyIsolated, type ParsedResume } from './resume-parser'

export interface StoredParseableDocument {
  id: string
  storageKey: string
  mimeType: string
}

/**
 * Download, parse, and persist parsedContent for a stored document.
 * Returns null when the file is readable but no text can be extracted.
 */
export async function parseAndPersistDocument(
  doc: StoredParseableDocument,
): Promise<ParsedResume | null> {
  const fileBuffer = await downloadFromS3(doc.storageKey)
  const parsedContent = await parseDocumentSafelyIsolated(fileBuffer, doc.mimeType)

  if (!parsedContent) return null

  await db.update(document)
    .set({ parsedContent: parsedContent as any })
    .where(eq(document.id, doc.id))

  return parsedContent
}
