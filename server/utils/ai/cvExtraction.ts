/**
 * CV Contact Extraction
 *
 * Pulls the identity fields needed to create a candidate (name, email, phone)
 * out of raw résumé text. Used by the "drop a CV" flow on the add-candidate
 * form so a recruiter never retypes what the document already says.
 *
 * Deliberately narrow: this extracts contact details only, not skills or work
 * history. Scoring already reads the full résumé text (see scoring.ts) — the
 * job here is to fill a form, and a small schema keeps it cheap and reliable.
 */
import { z } from 'zod'
import { generateStructuredOutput, type ProviderConfig } from './provider'

/**
 * Résumés run long and the contact block is almost always at the top. Cap the
 * prompt so a 40-page CV can't turn a form-fill into an expensive run.
 */
export const MAX_EXTRACTION_CHARS = 12_000

/**
 * Every field is nullable: a LinkedIn PDF export often has no email at all,
 * and inventing one would be worse than leaving the field blank for the
 * recruiter to fill in.
 */
const cvExtractionSchema = z.object({
  firstName: z.string().nullable().describe('Given name only, no titles or honorifics'),
  lastName: z.string().nullable().describe('Family name only'),
  email: z.string().nullable().describe('Personal email address, exactly as written'),
  phone: z.string().nullable().describe('Phone number, exactly as written including country code'),
})

export type CvExtraction = z.infer<typeof cvExtractionSchema>

/**
 * Résumés run long and the contact block sits at the top, so the tail is
 * rarely worth paying for. Truncation is by character, not token — cheap,
 * predictable, and it only has to be roughly right.
 */
export function truncateForExtraction(text: string): string {
  return text.slice(0, MAX_EXTRACTION_CHARS)
}

/**
 * Collapse a model response into values safe to drop straight into a form.
 * Whitespace-only and placeholder answers become null: a blank field the
 * recruiter fills in beats a confident-looking "N/A" they have to notice.
 */
const PLACEHOLDER_VALUES = new Set(['n/a', 'na', 'none', 'null', 'unknown', 'not provided', 'not specified', '-', '—'])

export function normalizeCvExtraction(raw: CvExtraction): CvExtraction {
  const clean = (value: string | null): string | null => {
    const trimmed = value?.trim()
    if (!trimmed) return null
    return PLACEHOLDER_VALUES.has(trimmed.toLowerCase()) ? null : trimmed
  }

  return {
    firstName: clean(raw.firstName),
    lastName: clean(raw.lastName),
    email: clean(raw.email),
    phone: clean(raw.phone),
  }
}

const SYSTEM_PROMPT = `You extract contact details from a résumé or CV so a recruiter can create a candidate record.

Rules:
- Return only what the document actually states. Never guess, infer, or invent a value.
- If a field is absent or you are not confident, return null for it.
- The name belongs to the person the CV is about — not a referee, employer, or previous colleague.
- Strip titles (Dr, Eng, Mr, Ms) and post-nominals from names.
- Return the email and phone verbatim. Do not normalise, reformat, or correct them.
- A LinkedIn profile export often has no email address. That is expected — return null.`

/**
 * Extract candidate contact fields from résumé text.
 * Returns nulls rather than throwing when the document yields nothing useful.
 */
export async function extractCandidateFromCv(
  config: ProviderConfig,
  resumeText: string,
): Promise<{ extraction: CvExtraction; usage: { promptTokens: number; completionTokens: number } }> {
  const result = await generateStructuredOutput(config, {
    system: SYSTEM_PROMPT,
    prompt: `Extract the candidate's contact details from this document:\n\n${truncateForExtraction(resumeText)}`,
    schema: cvExtractionSchema,
    schemaName: 'cv_contact_details',
    schemaDescription: 'Contact details of the person the CV describes',
  })

  return { extraction: normalizeCvExtraction(result.object), usage: result.usage }
}
