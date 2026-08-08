/**
 * Resume Parser
 *
 * Extracts text content from uploaded documents (PDF, DOCX, DOC).
 * Returns structured parsed content for storage in document.parsedContent.
 *
 * Supports:
 *   - PDF — via pdf-parse (pdfjs-dist based)
 *   - DOCX — via mammoth (XML-based, reliable)
 *   - DOC — via word-extractor (OLE2 compound documents)
 */
import mammoth from 'mammoth'
import { Worker } from 'node:worker_threads'
// @ts-ignore — word-extractor has no bundled type declarations
import WordExtractor from 'word-extractor'

// pdfjs-dist uses browser APIs (DOMMatrix, Path2D, ImageData) at module scope.
// In Node.js these don't exist, so we install minimal stubs before importing.
// We only use pdfjs-dist for text extraction — no actual rendering is needed.
function ensurePdfjsPolyfills() {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    // Minimal 6-value identity matrix stub — enough for pdfjs-dist text layer
    globalThis.DOMMatrix = class DOMMatrix {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
    } as any
  }
  if (typeof globalThis.ImageData === 'undefined') {
    globalThis.ImageData = class ImageData {
      data: Uint8ClampedArray; width: number; height: number
      constructor(w: number, h: number) {
        this.width = w; this.height = h
        this.data = new Uint8ClampedArray(w * h * 4)
      }
    } as any
  }
  if (typeof globalThis.Path2D === 'undefined') {
    globalThis.Path2D = class Path2D {} as any
  }
}

const PARSER_VERSION = '1.1'
export const DOCUMENT_MAX_EXTRACTED_CHARS = 100_000
export const DOCUMENT_MAX_PDF_PAGES = 50
export const DOCUMENT_PARSE_TIMEOUT_MS = 12_000
export const DOCX_MAX_ENTRIES = 2_000
export const DOCX_MAX_UNCOMPRESSED_BYTES = 24 * 1024 * 1024
export const DOCX_MAX_EXPANSION_RATIO = 100

export interface DocumentParseLimits {
  maxCharacters?: number
  maxPdfPages?: number
  timeoutMs?: number
}

export class DocumentLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentLimitError'
  }
}

export interface ParsedResume {
  /** Full extracted text content */
  text: string
  /** Detected sections (best-effort heuristic) */
  sections: ResumeSection[]
  /** Parsing metadata */
  metadata: {
    pageCount: number | null
    wordCount: number
    characterCount: number
    extractedAt: string
    parserVersion: string
    sourceFormat: 'pdf' | 'docx' | 'doc'
  }
}

export interface ResumeSection {
  heading: string
  content: string
}

/**
 * Why a parse produced no text.
 *
 * The distinction matters: `empty` is the document's fault (a scan, an
 * image-only export) and the recruiter can act on it, while `failed` is ours
 * and they can only be told to retry. Collapsing the two once let a missing
 * pdfjs worker in the production bundle masquerade as "every CV is a scan".
 */
export type DocumentParseFailure = 'unsupported_type' | 'empty' | 'failed'

export type DocumentParseResult =
  | { ok: true, parsed: ParsedResume }
  | { ok: false, reason: DocumentParseFailure }

/**
 * Parse a document buffer and extract text content, reporting *why* on failure.
 * Routes to the appropriate parser based on MIME type.
 *
 * @param buffer - Raw file bytes
 * @param mimeType - Validated MIME type of the document
 */
export async function parseDocumentDetailed(
  buffer: Buffer,
  mimeType: string,
): Promise<DocumentParseResult> {
  let parsed: ParsedResume | null
  try {
    switch (mimeType) {
      case 'application/pdf':
        parsed = await parsePdf(buffer)
        break
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        parsed = await parseDocx(buffer)
        break
      case 'application/msword':
        parsed = await parseDoc(buffer)
        break
      default:
        logWarn('resume_parser.unsupported_mime_type', {
          mime_type: mimeType,
        })
        return { ok: false, reason: 'unsupported_type' }
    }
  }
  catch (error) {
    logError('resume_parser.parse_failed', {
      mime_type: mimeType,
      error_message: error instanceof Error ? error.message : String(error),
    })
    return { ok: false, reason: 'failed' }
  }

  if (!parsed) {
    // Readable file, nothing to read — the scanned/image-only case. Logged so
    // it stays separable from `resume_parser.parse_failed` in PostHog.
    logWarn('resume_parser.no_text_extracted', {
      mime_type: mimeType,
      byte_size: buffer.length,
    })
    return { ok: false, reason: 'empty' }
  }

  return { ok: true, parsed }
}

/**
 * Parse a document buffer and extract text content.
 * Returns null when no text could be extracted, for whatever reason — use
 * {@link parseDocumentDetailed} when the caller needs to tell the reasons apart.
 *
 * @param buffer - Raw file bytes
 * @param mimeType - Validated MIME type of the document
 * @returns Structured parsed content, or null if extraction fails
 */
export async function parseDocument(
  buffer: Buffer,
  mimeType: string,
): Promise<ParsedResume | null> {
  const result = await parseDocumentDetailed(buffer, mimeType)
  return result.ok ? result.parsed : null
}

// ─── PDF Parser ───────────────────────────────────────────────────

async function parsePdf(buffer: Buffer): Promise<ParsedResume | null> {
  if (buffer.length === 0) return null

  // Polyfill browser globals before pdfjs-dist evaluates its module-level code
  ensurePdfjsPolyfills()
  const { PDFParse } = await import('pdf-parse')

  const parser = new PDFParse({ data: buffer })
  // pageJoiner defaults to "\n-- page_number of total_number --". Those markers
  // are not resume content: on an image-only CV they are the *only* text, so the
  // document reads as non-empty, gets stored, and reaches the model as the
  // candidate's entire resume — which scores 0% with nothing logged anywhere.
  const result = await parser.getText({ pageJoiner: '', first: DOCUMENT_MAX_PDF_PAGES + 1 })
  if (result.total > DOCUMENT_MAX_PDF_PAGES) {
    await parser.destroy()
    throw new DocumentLimitError(`PDF exceeds the ${DOCUMENT_MAX_PDF_PAGES}-page limit.`)
  }

  const text = capExtractedText(normalizeText(result.text), DOCUMENT_MAX_EXTRACTED_CHARS)
  if (!text) {
    await parser.destroy()
    return null
  }

  const parsed: ParsedResume = {
    text,
    sections: extractSections(text),
    metadata: {
      pageCount: result.total,
      wordCount: countWords(text),
      characterCount: text.length,
      extractedAt: new Date().toISOString(),
      parserVersion: PARSER_VERSION,
      sourceFormat: 'pdf',
    },
  }

  await parser.destroy()
  return parsed
}

// ─── DOCX Parser ──────────────────────────────────────────────────

async function parseDocx(buffer: Buffer): Promise<ParsedResume | null> {
  assertSafeDocxArchive(buffer)
  const result = await mammoth.extractRawText({ buffer })

  const text = capExtractedText(normalizeText(result.value), DOCUMENT_MAX_EXTRACTED_CHARS)
  if (!text) return null

  return {
    text,
    sections: extractSections(text),
    metadata: {
      pageCount: null, // DOCX doesn't have pages
      wordCount: countWords(text),
      characterCount: text.length,
      extractedAt: new Date().toISOString(),
      parserVersion: PARSER_VERSION,
      sourceFormat: 'docx',
    },
  }
}

// ─── DOC Parser (Legacy) ──────────────────────────────────────────

async function parseDoc(buffer: Buffer): Promise<ParsedResume | null> {
  const extractor = new WordExtractor()
  const doc = await extractor.extract(buffer)

  // Combine main body, headers, and footers
  const parts = [
    doc.getBody(),
    doc.getHeaders({ includeFooters: false }),
    doc.getFooters(),
  ].filter(Boolean)

  const rawText = parts.join('\n')
  const text = capExtractedText(normalizeText(rawText), DOCUMENT_MAX_EXTRACTED_CHARS)
  if (!text) return null

  return {
    text,
    sections: extractSections(text),
    metadata: {
      pageCount: null,
      wordCount: countWords(text),
      characterCount: text.length,
      extractedAt: new Date().toISOString(),
      parserVersion: PARSER_VERSION,
      sourceFormat: 'doc',
    },
  }
}

// ─── Text Normalization ───────────────────────────────────────────

/**
 * Clean up extracted text: collapse whitespace, trim, remove control chars.
 * Returns empty string if no meaningful content was extracted.
 */
function normalizeText(raw: string): string {
  return raw
    // Remove null bytes and control characters (except newline/tab)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Normalize Windows line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Collapse 3+ consecutive newlines into 2
    .replace(/\n{3,}/g, '\n\n')
    // Collapse multiple spaces/tabs on same line into one
    .replace(/[^\S\n]+/g, ' ')
    // Trim each line
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    // Final trim
    .trim()
}

function capExtractedText(text: string, maxCharacters: number): string {
  return text.length <= maxCharacters ? text : text.slice(0, maxCharacters)
}

/**
 * Reads only ZIP central-directory metadata; no entry is decompressed here.
 * Mammoth/JSZip is invoked only after aggregate size and expansion ratio pass.
 */
export function assertSafeDocxArchive(buffer: Buffer): void {
  const eocdSignature = 0x06054b50
  const centralSignature = 0x02014b50
  const minEocd = 22
  const searchStart = Math.max(0, buffer.length - 65_557)
  let eocd = -1
  for (let offset = buffer.length - minEocd; offset >= searchStart; offset--) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocd = offset
      break
    }
  }
  if (eocd < 0) throw new DocumentLimitError('DOCX archive is malformed.')

  const declaredEntries = buffer.readUInt16LE(eocd + 10)
  const centralSize = buffer.readUInt32LE(eocd + 12)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  if (declaredEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new DocumentLimitError('ZIP64 DOCX archives are not accepted.')
  }
  if (declaredEntries > DOCX_MAX_ENTRIES || centralOffset + centralSize > buffer.length) {
    throw new DocumentLimitError('DOCX archive exceeds safe structural limits.')
  }

  let entries = 0
  let compressedTotal = 0
  let uncompressedTotal = 0
  let offset = centralOffset
  const centralEnd = centralOffset + centralSize
  while (offset < centralEnd) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== centralSignature) {
      throw new DocumentLimitError('DOCX central directory is malformed.')
    }
    const compressed = buffer.readUInt32LE(offset + 20)
    const uncompressed = buffer.readUInt32LE(offset + 24)
    const filenameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) {
      throw new DocumentLimitError('ZIP64 DOCX entries are not accepted.')
    }
    compressedTotal += compressed
    uncompressedTotal += uncompressed
    entries++
    if (entries > DOCX_MAX_ENTRIES || uncompressedTotal > DOCX_MAX_UNCOMPRESSED_BYTES) {
      throw new DocumentLimitError('DOCX expanded content exceeds the safe limit.')
    }
    offset += 46 + filenameLength + extraLength + commentLength
  }
  if (entries !== declaredEntries || offset !== centralEnd) {
    throw new DocumentLimitError('DOCX central directory does not match its metadata.')
  }
  if (uncompressedTotal > 0 && uncompressedTotal / Math.max(1, compressedTotal) > DOCX_MAX_EXPANSION_RATIO) {
    throw new DocumentLimitError('DOCX compression ratio exceeds the safe limit.')
  }
}

const ISOLATED_PARSER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads')

function normalize(raw, maxCharacters) {
  return raw
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n').replace(/[^\S\n]+/g, ' ')
    .split('\n').map(line => line.trim()).join('\n').trim()
    .slice(0, maxCharacters)
}

function words(text) {
  return text ? text.split(/\s+/).filter(Boolean).length : 0
}

async function run() {
  const buffer = Buffer.from(workerData.data)
  const { mimeType, maxCharacters, maxPdfPages } = workerData
  let raw = ''
  let pageCount = null
  let sourceFormat

  if (mimeType === 'application/pdf') {
    if (typeof globalThis.DOMMatrix === 'undefined') globalThis.DOMMatrix = class DOMMatrix { constructor() { this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0 } }
    if (typeof globalThis.ImageData === 'undefined') globalThis.ImageData = class ImageData { constructor(w,h) { this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4) } }
    if (typeof globalThis.Path2D === 'undefined') globalThis.Path2D = class Path2D {}
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: buffer })
    try {
      const result = await parser.getText({ pageJoiner: '', first: maxPdfPages + 1 })
      if (result.total > maxPdfPages) throw new Error('PDF_PAGE_LIMIT')
      raw = result.text
      pageCount = result.total
      sourceFormat = 'pdf'
    } finally {
      await parser.destroy()
    }
  } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = require('mammoth')
    raw = (await mammoth.extractRawText({ buffer })).value
    sourceFormat = 'docx'
  } else if (mimeType === 'application/msword') {
    const WordExtractor = require('word-extractor')
    const doc = await new WordExtractor().extract(buffer)
    raw = [doc.getBody(), doc.getHeaders({ includeFooters: false }), doc.getFooters()].filter(Boolean).join('\n')
    sourceFormat = 'doc'
  } else {
    throw new Error('UNSUPPORTED_TYPE')
  }

  const text = normalize(raw, maxCharacters)
  if (!text) return null
  return {
    text,
    sections: [],
    metadata: {
      pageCount,
      wordCount: words(text),
      characterCount: text.length,
      extractedAt: new Date().toISOString(),
      parserVersion: '1.1',
      sourceFormat,
    },
  }
}

run().then(parsed => parentPort.postMessage({ ok: true, parsed }), error => parentPort.postMessage({ ok: false, error: error && error.message ? error.message : String(error) }))
`

/**
 * Parses untrusted uploads off the main event loop. Resource limits constrain
 * decompression/parser memory and terminate stops work at the wall-clock cap.
 */
export async function parseDocumentIsolated(
  buffer: Buffer,
  mimeType: string,
  limits: DocumentParseLimits = {},
): Promise<ParsedResume | null> {
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    assertSafeDocxArchive(buffer)
  }
  const maxCharacters = Math.min(
    DOCUMENT_MAX_EXTRACTED_CHARS,
    Math.max(1, limits.maxCharacters ?? DOCUMENT_MAX_EXTRACTED_CHARS),
  )
  const maxPdfPages = Math.min(
    DOCUMENT_MAX_PDF_PAGES,
    Math.max(1, limits.maxPdfPages ?? DOCUMENT_MAX_PDF_PAGES),
  )
  const timeoutMs = Math.min(30_000, Math.max(1_000, limits.timeoutMs ?? DOCUMENT_PARSE_TIMEOUT_MS))
  const data = Uint8Array.from(buffer).buffer as ArrayBuffer

  return await new Promise<ParsedResume | null>((resolve, reject) => {
    const worker = new Worker(ISOLATED_PARSER_SOURCE, {
      eval: true,
      workerData: { data, mimeType, maxCharacters, maxPdfPages },
      transferList: [data],
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
    })
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    const timer = setTimeout(() => {
      void worker.terminate()
      finish(() => reject(new DocumentLimitError('Document parsing timed out.')))
    }, timeoutMs)
    worker.once('message', (message: { ok: boolean, parsed?: ParsedResume | null, error?: string }) => {
      void worker.terminate()
      finish(() => {
        if (message.ok) resolve(message.parsed ?? null)
        else reject(new DocumentLimitError(
          message.error === 'PDF_PAGE_LIMIT'
            ? `PDF exceeds the ${maxPdfPages}-page limit.`
            : 'Document could not be parsed within safe limits.',
        ))
      })
    })
    worker.once('error', (error) => finish(() => reject(new DocumentLimitError(
      `Document parser failed: ${error instanceof Error ? error.message : String(error)}`,
    ))))
    worker.once('exit', (code) => {
      if (code !== 0) finish(() => reject(new DocumentLimitError('Document parser exceeded its resource limit.')))
    })
  })
}

export async function parseDocumentDetailedIsolated(
  buffer: Buffer,
  mimeType: string,
  limits: DocumentParseLimits = {},
): Promise<DocumentParseResult> {
  if (![
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
  ].includes(mimeType)) {
    return { ok: false, reason: 'unsupported_type' }
  }
  try {
    const parsed = await parseDocumentIsolated(buffer, mimeType, limits)
    return parsed ? { ok: true, parsed } : { ok: false, reason: 'empty' }
  }
  catch (error) {
    logError('resume_parser.isolated_parse_failed', {
      mime_type: mimeType,
      error_message: error instanceof Error ? error.message : String(error),
    })
    return { ok: false, reason: 'failed' }
  }
}

/** Best-effort isolated parsing for upload flows that may retain the file even when text extraction fails. */
export async function parseDocumentSafelyIsolated(
  buffer: Buffer,
  mimeType: string,
  limits: DocumentParseLimits = {},
): Promise<ParsedResume | null> {
  const result = await parseDocumentDetailedIsolated(buffer, mimeType, limits)
  return result.ok ? result.parsed : null
}

// ─── Section Extraction ───────────────────────────────────────────

/**
 * Best-effort extraction of resume sections based on common heading patterns.
 * This is a heuristic approach — not all resumes follow standard formats.
 */
const SECTION_HEADINGS = [
  // Experience / Work
  /^(?:work\s*)?experience/i,
  /^employment\s*(?:history)?/i,
  /^professional\s*(?:experience|background|history)/i,
  /^career\s*(?:history|summary)/i,
  /^work\s*history/i,

  // Education
  /^education(?:al\s*background)?/i,
  /^academic\s*(?:background|qualifications)/i,
  /^qualifications/i,

  // Skills
  /^(?:technical\s*)?skills/i,
  /^core\s*competencies/i,
  /^technologies/i,
  /^tools?\s*(?:&|and)\s*technologies/i,
  /^expertise/i,

  // Summary / Profile / Objective
  /^(?:professional\s*)?summary/i,
  /^(?:career\s*)?objective/i,
  /^profile/i,
  /^about\s*(?:me)?/i,

  // Certifications / Awards
  /^certifications?/i,
  /^licenses?\s*(?:&|and)\s*certifications?/i,
  /^awards?\s*(?:&|and)\s*(?:honors?|achievements?)/i,
  /^achievements?/i,
  /^honors?/i,

  // Projects / Publications
  /^(?:key\s*)?projects?/i,
  /^publications?/i,
  /^research/i,
  /^portfolio/i,

  // Languages / Interests
  /^languages?/i,
  /^interests?\s*(?:&|and)\s*(?:hobbies|activities)/i,
  /^hobbies/i,
  /^volunteer(?:ing)?\s*(?:experience)?/i,

  // References
  /^references?/i,

  // Contact
  /^contact\s*(?:information|details)?/i,
  /^personal\s*(?:information|details)/i,
]

function extractSections(text: string): ResumeSection[] {
  const lines = text.split('\n')
  const sections: ResumeSection[] = []
  let currentHeading: string | null = null
  let currentContent: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      currentContent.push('')
      continue
    }

    // Check if this line matches a known section heading pattern
    // Headings are typically short (< 60 chars) and on their own line
    const isHeading = trimmed.length < 60 && SECTION_HEADINGS.some(pattern => pattern.test(trimmed))

    if (isHeading) {
      // Save previous section
      if (currentHeading !== null) {
        const content = currentContent.join('\n').trim()
        if (content) {
          sections.push({ heading: currentHeading, content })
        }
      }
      currentHeading = trimmed
      currentContent = []
    }
    else {
      currentContent.push(trimmed)
    }
  }

  // Save last section
  if (currentHeading !== null) {
    const content = currentContent.join('\n').trim()
    if (content) {
      sections.push({ heading: currentHeading, content })
    }
  }

  return sections
}

// ─── Helpers ──────────────────────────────────────────────────────

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

// ─── Resume Text Extraction ──────────────────────────────────────

/**
 * Extract plain text from a parsedContent JSONB value.
 * Handles both the structured ParsedResume format and legacy string values.
 * Used by the scoring/analysis endpoints.
 *
 * @param parsedContent - The raw JSONB value from document.parsedContent
 * @returns The extracted text, or null if no content is available
 */
export function extractResumeText(parsedContent: unknown): string | null {
  if (!parsedContent) return null

  // Structured ParsedResume format: { text: "...", sections: [...], metadata: {...} }
  if (typeof parsedContent === 'object' && parsedContent !== null && 'text' in parsedContent) {
    const text = (parsedContent as { text: unknown }).text
    if (typeof text === 'string' && text.trim()) return text
    // If it has a text property but it's empty, there's no useful content
    return null
  }

  // Legacy: plain string value
  if (typeof parsedContent === 'string' && parsedContent.trim()) {
    return parsedContent
  }

  // Fallback: stringify object (should rarely happen)
  if (typeof parsedContent === 'object') {
    const str = JSON.stringify(parsedContent)
    return str && str !== '{}' && str !== '[]' ? str : null
  }

  return null
}
