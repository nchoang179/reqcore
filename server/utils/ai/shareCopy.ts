import { z } from 'zod'
import { generateStructuredOutput, type ProviderConfig } from './provider'

/**
 * AI-written social copy for promoting a job.
 *
 * The thing that stops a recruiter sharing a role isn't opening a composer —
 * it's staring at an empty box. So the product writes the post, and the share
 * buttons hand it to the platform's own composer with the tracking link
 * already attached. That needs no OAuth and no platform app review.
 */

/** Channels the share pack writes copy for. */
export const SHARE_CHANNELS = ['linkedin', 'twitter', 'facebook', 'whatsapp', 'reddit', 'email'] as const

export type ShareChannel = (typeof SHARE_CHANNELS)[number]

export const shareCopySchema = z.object({
  linkedin: z.string().describe('LinkedIn post, 3-5 short paragraphs, professional and warm, 2-4 relevant hashtags at the end'),
  twitter: z.string().describe('A single X/Twitter post under 240 characters, punchy, at most 2 hashtags'),
  facebook: z.string().describe('Facebook post, 2-3 sentences, friendly and plain-spoken, no hashtags'),
  whatsapp: z.string().describe('Short WhatsApp message to forward to a contact or group, 1-2 sentences, conversational'),
  reddit: z.string().describe('Reddit self-post body, plain and factual with no marketing language, describing the role and what the team is looking for'),
  email: z.string().describe('Short email to colleagues asking them to refer someone, 2-3 sentences, opens with a greeting'),
})

export type ShareCopy = z.infer<typeof shareCopySchema>

export interface ShareCopyInput {
  jobTitle: string
  jobDescription: string | null
  organizationName: string | null
  location: string | null
  remoteStatus: string | null
  salaryHint: string | null
}

export async function generateShareCopy(
  config: ProviderConfig,
  input: ShareCopyInput,
): Promise<{ copy: ShareCopy; usage: { promptTokens: number; completionTokens: number } }> {
  const facts = [
    `Job title: ${input.jobTitle}`,
    input.organizationName ? `Company: ${input.organizationName}` : null,
    input.location ? `Location: ${input.location}` : null,
    input.remoteStatus ? `Work arrangement: ${input.remoteStatus}` : null,
    input.salaryHint ? `Salary: ${input.salaryHint}` : null,
    input.jobDescription ? `\nJob description:\n${input.jobDescription.slice(0, 4000)}` : null,
  ].filter(Boolean).join('\n')

  const result = await generateStructuredOutput(config, {
    system: `You write social posts that recruiters use to advertise an open role.

Rules:
- Write as the hiring company, in first person plural ("we're hiring").
- Use only facts given to you. Never invent salary, benefits, team size, funding, or perks.
- Plain, direct language. No hype, no "rockstar"/"ninja"/"unicorn", no rhetorical questions.
- Do NOT include a URL or any placeholder for one — a tracked link is appended automatically.
- Do NOT include the word "apply" followed by a link placeholder.
- Match each channel's native tone and length. A LinkedIn post and an X post should not read the same.
- Write in the same language as the job description.`,
    prompt: facts,
    schema: shareCopySchema,
    schemaName: 'ShareCopy',
    schemaDescription: 'Per-channel social copy promoting a job opening',
  })

  return { copy: result.object, usage: result.usage }
}
