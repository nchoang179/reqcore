import { convert } from 'html-to-text'

export function normalizeEmailAddress(value: string): string {
  const angleAddress = value.match(/<([^<>]+)>/)?.[1]
  return (angleAddress ?? value).trim().toLowerCase()
}

export function emailDomain(value: string): string | null {
  const address = normalizeEmailAddress(value)
  const at = address.lastIndexOf('@')
  return at > 0 && at < address.length - 1 ? address.slice(at + 1) : null
}

export function isDedicatedReplyDomain(sender: string, replyDomain: string): boolean {
  return emailDomain(sender) !== replyDomain.trim().toLowerCase()
}

export function candidateReplyAddress(replyToken: string, domain: string): string {
  return `reply-${replyToken}@${domain.toLowerCase()}`
}

export function findReplyToken(addresses: string[], domain: string): string | null {
  const expectedDomain = domain.toLowerCase()
  for (const value of addresses) {
    const address = normalizeEmailAddress(value)
    const at = address.lastIndexOf('@')
    if (at < 1 || address.slice(at + 1) !== expectedDomain) continue
    const match = address.slice(0, at).match(/^reply-([a-f0-9]{32})$/)
    if (match?.[1]) return match[1]
  }
  return null
}

/**
 * Inbound replies are accepted from any address the conversation has actually
 * corresponded with, not just the candidate's current email. A candidate record
 * can be edited mid-conversation (typo fix, address change, merge), and the
 * recipient of the earlier messages keeps replying from the address that
 * received them. Matching only the current value silently discards those.
 *
 * Every address passed here is one the org either sent to or has already
 * accepted a reply from, so widening the match does not weaken the guard
 * against replies from someone a thread was forwarded to.
 */
export function isKnownConversationSender(
  sender: string,
  knownAddresses: (string | null | undefined)[],
): boolean {
  const from = normalizeEmailAddress(sender)
  if (!from) return false
  return knownAddresses.some(value => !!value && normalizeEmailAddress(value) === from)
}

export function parseReferences(value: string | undefined): string[] {
  if (!value) return []
  return value.match(/<[^>]+>/g) ?? value.split(/\s+/).filter(Boolean)
}

export function appendReference(references: string[] | null | undefined, messageId: string | null | undefined): string[] {
  return [...new Set([...(references ?? []), ...(messageId ? [messageId] : [])])]
}

export function inboundTextContent(text: string | null, html: string | null): string {
  const source = text?.trim() || (html ? convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
    ],
  }).trim() : '')
  if (!source) return '[No text content]'

  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const kept: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^On .+wrote:\s*$/i.test(trimmed)) break
    if (/^wrote:\s*$/i.test(trimmed)) {
      const searchStart = Math.max(0, kept.length - 4)
      const delimiterStart = kept.findLastIndex((value, index) => (
        index >= searchStart && /^On\s.+/i.test(value.trim())
      ))
      if (delimiterStart >= 0) {
        kept.splice(delimiterStart)
        break
      }
    }
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(trimmed)) break
    if (/^From:\s.+$/i.test(trimmed) && kept.at(-1)?.trim() === '') break
    if (line.trimStart().startsWith('>')) continue
    kept.push(line)
  }
  return kept.join('\n').trim() || source
}

export function replySubject(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`
}
