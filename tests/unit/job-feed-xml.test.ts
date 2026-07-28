import { describe, expect, it } from 'vitest'
import { XMLValidator } from 'fast-xml-parser'
import { feedCdata } from '../../server/utils/jobFeed'

/** Every character XML 1.0 rejects outright, and no others. */
const XML_ILLEGAL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/

/**
 * `/jobs.xml` is one feed for every organization, so a document a strict
 * ingester rejects costs every customer their distribution at once — not just
 * the org whose description carried the bad byte. Note that lenient parsers
 * (fast-xml-parser included) accept these characters, so the assertions below
 * check the bytes directly rather than trusting a parser to complain.
 */
describe('feedCdata', () => {
  it('wraps a value without altering ordinary text', () => {
    expect(feedCdata('Senior Engineer — Oslo')).toBe('<![CDATA[Senior Engineer — Oslo]]>')
  })

  it('keeps tab, newline and carriage return', () => {
    expect(feedCdata('a\tb\nc\rd')).toBe('<![CDATA[a\tb\nc\rd]]>')
  })

  it('strips characters XML 1.0 has no representation for', () => {
    // Vertical tab and form feed are what a description pasted out of Word or
    // a PDF arrives with — the dominant authoring path for this ICP.
    expect(feedCdata('Word\x0Bpaste\x0Chere')).toBe('<![CDATA[Wordpastehere]]>')
    expect(feedCdata('\x00null\x08bs\x1Besc\x7Fdel')).toBe('<![CDATA[nullbsescdel]]>')
  })

  it('cannot be terminated early, even via a stripped-out character', () => {
    expect(feedCdata('end ]]> more')).toBe('<![CDATA[end ]]&gt; more]]>')
    // Stripping first would otherwise join `]]` and `>` into a live terminator.
    expect(feedCdata('end ]]\x00> more')).toBe('<![CDATA[end ]]&gt; more]]>')
  })

  it('produces a well-formed document from a description full of control bytes', () => {
    const description = 'Duties:\x0B\x0C- ship things\x00 ]]> now'
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<source>\n  <job>\n'
      + `    <description>${feedCdata(description)}</description>\n`
      + '  </job>\n</source>\n'

    expect(xml).not.toMatch(XML_ILLEGAL)
    expect(XMLValidator.validate(xml)).toBe(true)
  })
})
