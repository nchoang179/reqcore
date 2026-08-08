import type { H3Event } from 'h3'

export interface LimitedMultipartFile {
  data: Buffer
  filename: string
  type?: string
}

const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024

/**
 * Reads a single-file multipart request while enforcing the byte ceiling as
 * chunks arrive. h3's readMultipartFormData buffers the complete request first,
 * which makes a post-parse size check ineffective against memory exhaustion.
 */
export async function readLimitedMultipartFile(
  event: H3Event,
  fieldName: string,
  maxFileBytes: number,
): Promise<LimitedMultipartFile> {
  const contentType = getHeader(event, 'content-type') ?? ''
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2]
  if (!contentType.toLowerCase().startsWith('multipart/form-data') || !boundary) {
    throw createError({ statusCode: 400, statusMessage: 'Expected multipart/form-data.' })
  }
  if (boundary.length > 200 || /[\r\n]/.test(boundary)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid multipart boundary.' })
  }

  const maxRequestBytes = maxFileBytes + MAX_MULTIPART_OVERHEAD_BYTES
  const declaredLength = Number(getHeader(event, 'content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxRequestBytes) {
    throw tooLarge(maxFileBytes)
  }

  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of event.node.req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    received += buffer.length
    if (received > maxRequestBytes) {
      setHeader(event, 'Connection', 'close')
      throw tooLarge(maxFileBytes)
    }
    chunks.push(buffer)
  }

  const body = Buffer.concat(chunks, received)
  const marker = Buffer.from(`--${boundary}`)
  const headerSeparator = Buffer.from('\r\n\r\n')
  let cursor = 0

  while (cursor < body.length) {
    const boundaryStart = body.indexOf(marker, cursor)
    if (boundaryStart < 0) break
    let partStart = boundaryStart + marker.length
    if (body.subarray(partStart, partStart + 2).equals(Buffer.from('--'))) break
    if (body.subarray(partStart, partStart + 2).equals(Buffer.from('\r\n'))) partStart += 2

    const headersEnd = body.indexOf(headerSeparator, partStart)
    if (headersEnd < 0 || headersEnd - partStart > 16 * 1024) {
      throw createError({ statusCode: 400, statusMessage: 'Malformed multipart data.' })
    }
    const headers = body.subarray(partStart, headersEnd).toString('latin1')
    const nextBoundary = body.indexOf(Buffer.from(`\r\n--${boundary}`), headersEnd + 4)
    if (nextBoundary < 0) {
      throw createError({ statusCode: 400, statusMessage: 'Malformed multipart data.' })
    }

    const disposition = /^content-disposition:\s*form-data;([^\r\n]+)$/im.exec(headers)?.[1] ?? ''
    const name = /(?:^|;)\s*name="([^"]*)"/i.exec(disposition)?.[1]
    const filename = /(?:^|;)\s*filename="([^"]*)"/i.exec(disposition)?.[1]
    if (name === fieldName && filename) {
      const data = body.subarray(headersEnd + 4, nextBoundary)
      if (data.length > maxFileBytes) throw tooLarge(maxFileBytes)
      const mime = /^content-type:\s*([^\r\n;]+)/im.exec(headers)?.[1]?.trim()
      return {
        data: Buffer.from(data),
        filename: sanitizeFilename(filename),
        type: mime,
      }
    }
    cursor = nextBoundary + 2
  }

  throw createError({ statusCode: 400, statusMessage: 'No file provided' })
}

function sanitizeFilename(value: string): string {
  return value.replace(/\\/g, '/').split('/').at(-1)!.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 255)
}

function tooLarge(maxFileBytes: number) {
  return createError({
    statusCode: 413,
    statusMessage: `File too large. Max ${maxFileBytes / 1024 / 1024} MB.`,
  })
}
