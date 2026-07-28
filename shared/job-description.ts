/**
 * Job description conversions.
 *
 * Descriptions are authored as markdown. Two consumers need them in other
 * shapes: meta tags / JSON-LD want plain text, and the job board feed
 * (`/jobs.xml`) wants a conservative HTML subset.
 */

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
