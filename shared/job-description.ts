/**
 * Job description conversions.
 *
 * Descriptions are authored as markdown. Two consumers need them in other
 * shapes: meta tags / JSON-LD want plain text, and the job board feed
 * (`/jobs.xml`) wants a conservative HTML subset.
 */

/**
 * Bullet glyphs a description arrives with when it was pasted out of Word, a
 * PDF, or another job board. None of them are markdown list markers, so they
 * survive into the output as literal characters in a paragraph.
 */
const PASTED_BULLET = /^[•▪▫◦‣∙·●○]\s+/

/** A markdown list marker plus the whitespace separating it from its content. */
const LIST_MARKER = /^([-*+]|\d{1,9}[.)])(\s+)/

/** Leading whitespace width, counting a tab as four columns. */
function indentWidth(line: string): number {
  let width = 0
  for (const char of line) {
    if (char === ' ') width += 1
    else if (char === '\t') width += 4
    else break
  }
  return width
}

/** An open list item: where it sat in the source, and where it now sits. */
type ListLevel = { source: number; output: number; content: number }

/** A line that opens or closes a fenced code block. */
const FENCE = /^\s{0,3}(```|~~~)/

/** Markdown constructs whose own leading character already carries structure. */
const STRUCTURED = /^(#{1,6}\s|>|\||=+$|-{3,}$)/

/** Index of each line inside a fenced code block, fences included. */
function markFences(lines: string[]): boolean[] {
  let inFence = false
  return lines.map((line) => {
    const isDelimiter = FENCE.test(line)
    if (isDelimiter) inFence = !inFence
    return inFence || isDelimiter
  })
}

/**
 * Restore bullets that survived a paste only as indentation.
 *
 * An HTML `<ul>` copied out of a job board arrives as a run of indented lines
 * with the bullet character itself dropped by the clipboard. Dedenting alone
 * leaves them as a wall of one-line paragraphs, which is what the list looked
 * like before this and reads as unstructured.
 *
 * The indentation is evidence, not a guess, so a run is only rebuilt when it is
 * unambiguous: two or more single-line, blank-separated, equally indented
 * blocks that carry no markdown of their own. Wrapped prose is never
 * blank-separated between its lines, so it cannot be caught by this.
 */
function restorePastedBullets(lines: string[]): string[] {
  const fenced = markFences(lines)

  // Maximal runs of adjacent non-blank, unfenced lines.
  const blocks: { start: number; length: number }[] = []
  let open: number | null = null
  for (let i = 0; i <= lines.length; i += 1) {
    const breaks = i === lines.length || fenced[i] || !lines[i]!.trim()
    if (breaks) {
      if (open !== null) blocks.push({ start: open, length: i - open })
      open = null
    } else if (open === null) {
      open = i
    }
  }

  const out = [...lines]
  let run: number[] = []
  let runIndent = -1

  const flush = () => {
    if (run.length >= 2) {
      for (const index of run) out[index] = `${' '.repeat(runIndent)}- ${lines[index]!.trim()}`
    }
    run = []
  }

  for (const block of blocks) {
    const line = lines[block.start]!
    const body = line.trim()
    const indent = indentWidth(line)
    const isOrphanBullet =
      block.length === 1 &&
      indent >= 4 &&
      !LIST_MARKER.test(body) &&
      !PASTED_BULLET.test(body) &&
      !STRUCTURED.test(body)

    if (isOrphanBullet && (run.length === 0 || indent === runIndent)) {
      runIndent = indent
      run.push(block.start)
      continue
    }

    flush()
    if (isOrphanBullet) {
      runIndent = indent
      run = [block.start]
    }
  }
  flush()

  return out
}

/**
 * Make a pasted description safe to hand to a markdown parser.
 *
 * Descriptions are authored as markdown, but most arrive pasted from a job
 * board, a PDF, or Word, which carry indentation the author never sees. To a
 * markdown parser a line indented four columns is an *indented code block*, so
 * a pasted requirements list renders as grey monospace boxes rather than a
 * list — the single worst-looking thing on the public apply page.
 *
 * A job description has no reason to contain an indented code block (fenced
 * blocks still work and are passed through untouched), so indentation is kept
 * only where it genuinely continues an enclosing list item, and re-emitted at
 * the column that list item's content actually starts at. Pasted bullet glyphs
 * are promoted to real list markers on the way through, and see
 * `restorePastedBullets` for the lists that arrive with no marker at all.
 */
export function normalizeDescriptionMarkdown(markdown?: string | null): string {
  if (!markdown) return ''

  const lines = restorePastedBullets(markdown.replace(/\r\n?/g, '\n').split('\n'))
  const out: string[] = []
  const stack: ListLevel[] = []
  let inFence = false
  let blankRun = 0

  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence
      blankRun = 0
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }

    const body = line.trim()
    if (!body) {
      // A blank line keeps the enclosing list open (markdown loose lists), but
      // runs of them are pasting noise and only add dead space to the page.
      blankRun += 1
      if (blankRun === 1) out.push('')
      continue
    }
    blankRun = 0

    const indent = indentWidth(line)
    while (stack.length > 0 && indent < stack[stack.length - 1]!.source) stack.pop()
    const enclosing = stack[stack.length - 1]

    const bulleted = body.replace(PASTED_BULLET, '- ')
    const marker = bulleted.match(LIST_MARKER)

    if (marker) {
      // Collapse the marker's own padding so `-      item` can't push its
      // content four columns in and reopen the code-block problem one line down.
      const normalized = `${marker[1]} ${bulleted.slice(marker[0].length)}`
      const deeper = !!enclosing && indent > enclosing.source
      const output = deeper ? enclosing.content : (enclosing?.output ?? 0)
      const level: ListLevel = {
        source: indent,
        output,
        content: output + marker[1]!.length + 1,
      }
      if (!deeper) stack.pop()
      stack.push(level)
      out.push(' '.repeat(output) + normalized)
      continue
    }

    if (enclosing && indent > enclosing.source) {
      // Wrapped text belonging to the list item above it.
      out.push(' '.repeat(enclosing.content) + body)
      continue
    }

    stack.length = 0
    out.push(body)
  }

  return out.join('\n').trim()
}

/**
 * Strip markdown to a single line of plain text.
 * Used for meta descriptions and as the JSON-LD fallback.
 */
export function markdownToPlainText(markdown?: string | null): string {
  if (!markdown) return ''

  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d+\.\s+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Inline markdown → HTML. Input must already be HTML-escaped. */
function renderInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    // Links are flattened to their label. Aggregators routinely reject or strip
    // descriptions containing outbound links, because a link is a way to route
    // candidates around their apply flow. The canonical URL is carried by the
    // feed's own <url> element, so nothing is lost.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>')
}

/**
 * Convert a markdown description to the small HTML subset job boards render:
 * `<h3>`, `<p>`, `<ul>`/`<ol>`/`<li>`, `<strong>`, `<em>`.
 *
 * Deliberately hand-rolled rather than routed through the app's MDC renderer:
 * MDC targets the browser and emits a Vue AST, and this needs to guarantee no
 * author-supplied raw HTML ever reaches the feed. Input is escaped first, so
 * every tag in the output is one this function emitted.
 */
export function markdownToFeedHtml(markdown?: string | null): string {
  if (!markdown) return ''

  const lines = escapeHtml(markdown.replace(/```[\s\S]*?```/g, '')).split(/\r?\n/)
  const out: string[] = []
  let listTag: 'ul' | 'ol' | null = null
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${renderInline(paragraph.join(' ')).trim()}</p>`)
      paragraph = []
    }
  }
  const closeList = () => {
    if (listTag) {
      out.push(`</${listTag}>`)
      listTag = null
    }
  }
  const openList = (tag: 'ul' | 'ol') => {
    if (listTag !== tag) {
      closeList()
      out.push(`<${tag}>`)
      listTag = tag
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed) {
      flushParagraph()
      closeList()
      continue
    }

    const heading = trimmed.match(/^#{1,6}\s+(.*)$/)
    if (heading?.[1]) {
      flushParagraph()
      closeList()
      // Collapsed to h3 regardless of level: a feed item is a fragment inside
      // the board's own page, so h1/h2 would fight its document outline.
      out.push(`<h3>${renderInline(heading[1]).trim()}</h3>`)
      continue
    }

    const bullet = trimmed.match(/^[-*+]\s+(.*)$/)
    if (bullet?.[1]) {
      flushParagraph()
      openList('ul')
      out.push(`<li>${renderInline(bullet[1]).trim()}</li>`)
      continue
    }

    const numbered = trimmed.match(/^\d+\.\s+(.*)$/)
    if (numbered?.[1]) {
      flushParagraph()
      openList('ol')
      out.push(`<li>${renderInline(numbered[1]).trim()}</li>`)
      continue
    }

    closeList()
    paragraph.push(trimmed)
  }

  flushParagraph()
  closeList()

  return out.join('')
}
