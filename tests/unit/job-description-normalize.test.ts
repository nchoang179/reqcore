import { describe, expect, it } from 'vitest'
import { normalizeDescriptionMarkdown } from '../../shared/job-description'

/**
 * Descriptions are authored as markdown but almost never typed as markdown —
 * they are pasted from a job board, a PDF, or Word, which carry invisible
 * indentation. Markdown reads a four-column indent as a code block, so an
 * untouched paste turns the requirements list on the public apply page into
 * grey monospace boxes. These cases are the paste shapes that actually reach
 * the renderer.
 */
describe('normalizeDescriptionMarkdown', () => {
  it('returns an empty string for missing input', () => {
    expect(normalizeDescriptionMarkdown()).toBe('')
    expect(normalizeDescriptionMarkdown(null)).toBe('')
    expect(normalizeDescriptionMarkdown('')).toBe('')
  })

  it('leaves well-formed markdown alone', () => {
    const source = [
      'We are looking for a DevOps Engineer.',
      '',
      "**What you'll do**",
      '- Build CI/CD pipelines',
      '- Maintain containerized environments',
    ].join('\n')

    expect(normalizeDescriptionMarkdown(source)).toBe(source)
  })

  it('rebuilds a list the clipboard left as bare indentation', () => {
    // The shape a job board paste arrives in: a bare section label followed by
    // four-space-indented lines that were <li> elements on the source page.
    const source = 'Arbeidsoppgaver\n\n    Prosjektering av prosessløsninger\n\n    Beregninger og hydraulikk'

    expect(normalizeDescriptionMarkdown(source)).toBe(
      'Arbeidsoppgaver\n\n- Prosjektering av prosessløsninger\n\n- Beregninger og hydraulikk',
    )
  })

  it('leaves a lone indented line as a paragraph', () => {
    // One indented line is as likely to be a stray indent as a list, and a
    // one-item list looks worse than the paragraph it came from.
    expect(normalizeDescriptionMarkdown('About us\n\n\tWe build hiring software.')).toBe(
      'About us\n\nWe build hiring software.',
    )
  })

  it('does not turn an indented wrapped paragraph into bullets', () => {
    // Wrapped prose has no blank line between its lines, which is the signal
    // that separates it from a pasted list.
    const source = ['    We are hiring a process engineer to join', '    our water treatment team in Asker.'].join('\n')

    expect(normalizeDescriptionMarkdown(source)).toBe(
      'We are hiring a process engineer to join\nour water treatment team in Asker.',
    )
  })

  it('does not rebuild lines that carry their own markdown', () => {
    const source = '    ## Requirements\n\n    > Applications close Friday'

    expect(normalizeDescriptionMarkdown(source)).toBe('## Requirements\n\n> Applications close Friday')
  })

  it('ends a rebuilt run when the indent changes', () => {
    const source = ['    Docker', '', '    Linux', '', '  Applications close Friday'].join('\n')

    expect(normalizeDescriptionMarkdown(source)).toBe(
      ['- Docker', '', '- Linux', '', 'Applications close Friday'].join('\n'),
    )
  })

  it('attaches a line indented past a rebuilt bullet to that bullet', () => {
    const source = ['    Docker', '', '    Linux', '', '        including kernel tuning'].join('\n')

    expect(normalizeDescriptionMarkdown(source)).toBe(
      ['- Docker', '', '- Linux', '', '  including kernel tuning'].join('\n'),
    )
  })

  it('does not rebuild indented lines inside a fenced block', () => {
    const source = ['```', '    alpha', '', '    beta', '```'].join('\n')

    expect(normalizeDescriptionMarkdown(source)).toBe(source)
  })

  it('promotes pasted bullet glyphs to list markers', () => {
    const source = ['Requirements', '• Docker and Linux', '▪ CI/CD experience', '‣ Networking fundamentals'].join('\n')

    expect(normalizeDescriptionMarkdown(source)).toBe(
      ['Requirements', '- Docker and Linux', '- CI/CD experience', '- Networking fundamentals'].join('\n'),
    )
  })

  it('dedents an indented list to the top level', () => {
    expect(normalizeDescriptionMarkdown('Requirements\n\n    - Docker\n    - Linux')).toBe(
      'Requirements\n\n- Docker\n- Linux',
    )
  })

  it('keeps siblings level instead of nesting them deeper each line', () => {
    const source = ['- Platform', '        - Docker', '        - Linux', '- Delivery'].join('\n')

    expect(normalizeDescriptionMarkdown(source)).toBe(
      ['- Platform', '  - Docker', '  - Linux', '- Delivery'].join('\n'),
    )
  })

  it('nests under an ordered item at that item\'s content column', () => {
    // `1. ` puts content at column 3, so a two-space child would read as a new
    // top-level list rather than a nested one.
    expect(normalizeDescriptionMarkdown('1. Apply\n\t- Upload a resume')).toBe('1. Apply\n   - Upload a resume')
  })

  it('re-indents wrapped list text to its item, not to a code block', () => {
    expect(normalizeDescriptionMarkdown('- Build CI/CD pipelines\n      for faster releases')).toBe(
      '- Build CI/CD pipelines\n  for faster releases',
    )
  })

  it('collapses the marker padding a paste leaves behind', () => {
    // Left as-is, `-` plus five spaces puts content at column 6 and the parser
    // reads the item body itself as an indented code block.
    expect(normalizeDescriptionMarkdown('-     Docker and Linux')).toBe('- Docker and Linux')
  })

  it('closes the list when a paragraph returns to the left margin', () => {
    const source = ['- Docker', '- Linux', '', 'Send your application by Friday.'].join('\n')

    expect(normalizeDescriptionMarkdown(source)).toBe(source)
  })

  it('passes fenced code blocks through untouched', () => {
    const source = ['Example config:', '', '```yaml', 'services:', '    web:', '        image: nginx', '```'].join('\n')

    expect(normalizeDescriptionMarkdown(source)).toBe(source)
  })

  it('collapses runs of blank lines and trims the edges', () => {
    expect(normalizeDescriptionMarkdown('\n\nFirst\n\n\n\n\nSecond\n\n')).toBe('First\n\nSecond')
  })

  it('normalizes CRLF line endings', () => {
    expect(normalizeDescriptionMarkdown('First\r\n\r\n    Second')).toBe('First\n\nSecond')
  })
})
