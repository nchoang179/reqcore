/**
 * The worked example behind "Create a test job".
 *
 * Someone evaluating Reqcore wants to walk the real create-a-job wizard — that
 * is the thing they came to try. What they do not want is to invent a job
 * description first, and the board is full of "fsfsf" and "53W5" roles because
 * that is what people type to get past the form. So the wizard is pre-filled
 * with this instead: a complete, believable role they can read, edit or simply
 * click through.
 *
 * The applicants below ship with their scores already written. Nothing here
 * calls a model — a sample run would otherwise bill real inference for every
 * curious signup, which is exactly the unbounded cost the budget gates exist to
 * stop. The numbers are fixed, so the demo also looks the same every time.
 *
 * Support Specialist rather than an engineering role on purpose: it reads to
 * anyone, which matters when the visitor may be a staffing agency or a
 * five-person company rather than a tech recruiter.
 */

export const SAMPLE_JOB_FORM = {
  title: 'Customer Support Specialist',
  description: `We are looking for a Customer Support Specialist to be the first person our customers hear from. You will answer questions over email and live chat, solve problems end to end, and make sure nobody leaves a conversation more confused than they arrived.

**What you'll do**
- Answer customer questions over email and live chat, usually within the same day
- Take ownership of a problem until it is genuinely resolved, not just handed off
- Write and maintain help centre articles for the questions that keep coming back
- Pass clear, reproducible bug reports to the product team
- Spot patterns in what customers struggle with and tell us about them

**What we're looking for**
- 2+ years in a customer-facing support role
- Excellent written English and a calm, plain-spoken tone
- Comfort with a helpdesk tool such as Zendesk, Intercom or Front
- Patience with people who are frustrated, and the judgement to know when to escalate

**Nice to have**
- Experience supporting a B2B software product
- A second language
- Some familiarity with SQL or basic troubleshooting tools`,
  locationCity: 'Manchester',
  locationRegion: 'England',
  locationCountry: 'GB',
  locationPostalCode: null as string | null,
  type: 'full_time' as const,
  experienceLevel: 'mid' as const,
  remoteStatus: 'hybrid' as const,
}

/** Two questions — enough to show the form builder without a wall of fields. */
export const SAMPLE_JOB_QUESTIONS = [
  {
    label: 'How many years have you worked in a customer-facing support role?',
    type: 'single_select' as const,
    description: null,
    required: true,
    options: ['Less than 1 year', '1-2 years', '3-5 years', 'More than 5 years'],
  },
  {
    label: 'Tell us about a time you turned around an unhappy customer.',
    type: 'long_text' as const,
    description: 'A few sentences is plenty.',
    required: true,
    options: null,
  },
]

/**
 * The knockout rule the test job ships with.
 *
 * Automation rules are the feature nobody discovers on their own — they live on
 * a tab behind the pipeline, and an empty rule builder explains nothing. So the
 * test job arrives with the canonical one already running: the role asks for 2+
 * years, so anyone answering "Less than 1 year" is rejected on submit. Three of
 * the eight applicants below answer exactly that, which means the walkthrough
 * lands on a pipeline that has already sorted itself — five to read, three
 * rejected with the rule that did it named on each of them.
 *
 * "1-2 years" is deliberately left in even though the role asks for 2+: it
 * straddles the bar, and a sample rule that threw out applicants the visitor can
 * see were worth reading would make automation look reckless rather than useful.
 *
 * Conditions point at questions by position in {@link SAMPLE_JOB_QUESTIONS};
 * the real question ids only exist once the wizard has created the job. The
 * expected `questionType` is carried along so the server can tell that the
 * question in that position is still the one the rule was written against — the
 * recruiter is free to edit or delete it in step 2, and a rule silently
 * re-pointed at a different question would reject the wrong people.
 */
export const SAMPLE_JOB_RULE = {
  name: 'Knockout: under a year of support experience',
  matchType: 'all' as const,
  action: 'rejected' as const,
  enabled: true,
  conditions: [
    {
      questionIndex: 0,
      questionType: 'single_select' as const,
      operator: 'is_one_of' as const,
      value: ['Less than 1 year'],
    },
  ],
}

export const SAMPLE_SCORING_CRITERIA = [
  {
    key: 'support_experience',
    name: 'Support experience',
    description: 'Depth of hands-on experience in a customer-facing support role, ideally for a software product.',
    category: 'experience' as const,
    maxScore: 10,
    weight: 80,
  },
  {
    key: 'written_communication',
    name: 'Written communication',
    description: 'Clarity, tone and structure of their writing — the core of the job in an email-and-chat role.',
    category: 'soft_skills' as const,
    maxScore: 10,
    weight: 90,
  },
  {
    key: 'problem_ownership',
    name: 'Problem ownership',
    description: 'Evidence of following an issue through to resolution rather than passing it along.',
    category: 'soft_skills' as const,
    maxScore: 10,
    weight: 70,
  },
  {
    key: 'tooling',
    name: 'Helpdesk tooling',
    description: 'Familiarity with helpdesk platforms and basic troubleshooting tools.',
    category: 'technical' as const,
    maxScore: 10,
    weight: 40,
  },
]

export interface SampleCriterionScore {
  criterionKey: string
  applicantScore: number
  maxScore: number
  confidence: number
  evidence: string
  strengths: string[]
  gaps: string[]
}

export interface SampleApplicant {
  firstName: string
  lastName: string
  /** @example.com is reserved by RFC 2606 — these addresses can never deliver. */
  email: string
  phone: string | null
  /**
   * Overall score out of 100, as the shortlist ranks on.
   *
   * Ignored for applicants {@link SAMPLE_JOB_RULE} knocks out: a real
   * auto-rejected application is never sent for scoring (see
   * server/api/public/jobs/[slug]/apply.post.ts), so the sample ones arrive
   * unscored too rather than showing a number the product would not have paid
   * for.
   */
  score: number
  coverLetterText: string
  /** Answers, positionally matched to SAMPLE_JOB_QUESTIONS. */
  answers: string[]
  criterionScores: SampleCriterionScore[]
}

/**
 * Eight applicants spanning a clear range. The spread is the point: a shortlist
 * only feels like permission to stop reading if the bottom of it is visibly
 * worse than the top.
 *
 * The three who answer "Less than 1 year" are knocked out by
 * {@link SAMPLE_JOB_RULE} before scoring, so the ranked list the walkthrough
 * opens on is the remaining five.
 */
export const SAMPLE_APPLICANTS: SampleApplicant[] = [
  {
    firstName: 'Priya',
    lastName: 'Raman',
    email: 'priya.raman@example.com',
    phone: '+44 7700 900312',
    score: 92,
    coverLetterText: 'I have spent four years supporting B2B software customers, the last two as the senior specialist on a three-person team handling roughly 60 conversations a day. I write the kind of reply that ends the thread rather than extending it, and I built the help centre that cut our repeat questions by about a third.',
    answers: ['3-5 years', 'A customer had lost two days of work to a sync bug and opened with "this is the third time". I stopped trying to defend the product, reproduced the issue on a call with them, and got engineering a clean report the same afternoon. I sent them a note when the fix shipped eleven days later. They are still a customer.'],
    criterionScores: [
      { criterionKey: 'support_experience', applicantScore: 9, maxScore: 10, confidence: 92, evidence: 'Four years in B2B software support, two of them senior on a small team at roughly 60 conversations per day.', strengths: ['Directly relevant B2B software support', 'High sustained volume'], gaps: [] },
      { criterionKey: 'written_communication', applicantScore: 10, maxScore: 10, confidence: 95, evidence: 'Cover letter and long-form answer are both plain, structured and free of filler. Describes writing replies that close threads.', strengths: ['Exceptionally clear plain English', 'Writes to resolve rather than to reply'], gaps: [] },
      { criterionKey: 'problem_ownership', applicantScore: 9, maxScore: 10, confidence: 90, evidence: 'Followed a sync bug from reproduction through engineering handoff to telling the customer when it shipped, eleven days later.', strengths: ['Followed through past the handoff', 'Closed the loop with the customer unprompted'], gaps: [] },
      { criterionKey: 'tooling', applicantScore: 8, maxScore: 10, confidence: 78, evidence: 'Built and maintained a help centre; helpdesk platform not named explicitly.', strengths: ['Help centre ownership'], gaps: ['Specific helpdesk tool not stated'] },
    ],
  },
  {
    firstName: 'Tomás',
    lastName: 'Oliveira',
    email: 'tomas.oliveira@example.com',
    phone: '+44 7700 900187',
    score: 88,
    coverLetterText: 'Three years on a support desk for an accounting product, where nearly every conversation was with someone under deadline pressure. I am comfortable with Zendesk and Front, and I have written about forty help articles. I am looking for a team where support feeds back into the product rather than just absorbing complaints.',
    answers: ['3-5 years', 'A bookkeeper was locked out during a filing deadline and was, understandably, furious. I got her a temporary workaround within twenty minutes so she could file, then fixed the underlying account issue afterwards. Solving the deadline first and the root cause second is what turned it around.'],
    criterionScores: [
      { criterionKey: 'support_experience', applicantScore: 9, maxScore: 10, confidence: 90, evidence: 'Three years supporting an accounting software product with consistently high-stakes, deadline-driven conversations.', strengths: ['Relevant B2B software context', 'Experience under pressure'], gaps: [] },
      { criterionKey: 'written_communication', applicantScore: 9, maxScore: 10, confidence: 88, evidence: 'Clear, well-ordered writing throughout. Forty help articles authored.', strengths: ['Documentation experience', 'Orderly structure'], gaps: [] },
      { criterionKey: 'problem_ownership', applicantScore: 9, maxScore: 10, confidence: 87, evidence: 'Unblocked the customer inside twenty minutes, then returned to fix the root cause rather than leaving the workaround in place.', strengths: ['Separated the urgent from the underlying', 'Returned to close it properly'], gaps: [] },
      { criterionKey: 'tooling', applicantScore: 9, maxScore: 10, confidence: 92, evidence: 'Names Zendesk and Front directly.', strengths: ['Two of the three named platforms'], gaps: [] },
    ],
  },
  {
    firstName: 'Aisha',
    lastName: 'Bello',
    email: 'aisha.bello@example.com',
    phone: '+44 7700 900455',
    score: 81,
    coverLetterText: 'Two and a half years in support, most recently for a logistics platform. I handle chat well and I am told my written tone stays calm when the customer is not. I have not worked with SQL but I have done a lot of first-line troubleshooting and I pick tools up quickly.',
    answers: ['1-2 years', 'A customer had been passed between three people before reaching me. I read the whole history before replying so they would not have to repeat themselves, apologised once, and then just fixed it. Not making them start over was most of the fix.'],
    criterionScores: [
      { criterionKey: 'support_experience', applicantScore: 7, maxScore: 10, confidence: 85, evidence: 'Two and a half years in software support for a logistics platform.', strengths: ['Genuine B2B software support'], gaps: ['Shorter tenure than the strongest applicants'] },
      { criterionKey: 'written_communication', applicantScore: 9, maxScore: 10, confidence: 86, evidence: 'Answer shows real judgement about tone — reading history first, apologising once rather than repeatedly.', strengths: ['Calm register under pressure', 'Economical with apology'], gaps: [] },
      { criterionKey: 'problem_ownership', applicantScore: 8, maxScore: 10, confidence: 82, evidence: 'Took over a thrice-escalated thread and resolved it without further handoff.', strengths: ['Absorbed the escalation instead of passing it on'], gaps: [] },
      { criterionKey: 'tooling', applicantScore: 6, maxScore: 10, confidence: 80, evidence: 'First-line troubleshooting experience but no named helpdesk platform and no SQL.', strengths: ['Self-aware about the gap'], gaps: ['No named helpdesk tool', 'No SQL'] },
    ],
  },
  {
    firstName: 'Daniel',
    lastName: 'Whitfield',
    email: 'daniel.whitfield@example.com',
    phone: '+44 7700 900620',
    score: 74,
    coverLetterText: 'Five years in retail customer service, the last year of it managing a small team. I am now moving into software support. I know that is a change of context, but the core of the work — listening properly and being straight with people — is what I have been doing all along.',
    answers: ['More than 5 years', 'A customer wanted a refund well outside our policy window. I could not give him what he asked for, so I told him plainly and early rather than stalling, and found the one thing I could do. He thanked me for not wasting his time.'],
    criterionScores: [
      { criterionKey: 'support_experience', applicantScore: 5, maxScore: 10, confidence: 88, evidence: 'Five years of customer service, but retail rather than software. No helpdesk or B2B product exposure.', strengths: ['Long customer-facing tenure', 'Team lead experience'], gaps: ['No software support experience', 'Different problem domain'] },
      { criterionKey: 'written_communication', applicantScore: 8, maxScore: 10, confidence: 80, evidence: 'Writes plainly and honestly; frames the career change without over-explaining it.', strengths: ['Direct and unpadded'], gaps: ['No written-support samples'] },
      { criterionKey: 'problem_ownership', applicantScore: 8, maxScore: 10, confidence: 79, evidence: 'Chose to deliver a firm no early rather than let the customer hope.', strengths: ['Comfortable delivering bad news', 'Respects the customer\'s time'], gaps: [] },
      { criterionKey: 'tooling', applicantScore: 3, maxScore: 10, confidence: 84, evidence: 'No helpdesk platform experience mentioned.', strengths: [], gaps: ['No helpdesk tooling', 'Would need onboarding from scratch'] },
    ],
  },
  {
    firstName: 'Mei',
    lastName: 'Chen',
    email: 'mei.chen@example.com',
    phone: '+44 7700 900733',
    score: 66,
    coverLetterText: 'I have worked for eighteen months on a support team for a mobile app, mostly handling app store reviews and inbound email. I am keen to move to a product with more depth where the questions are harder than password resets.',
    answers: ['1-2 years', 'Someone left a one-star review after a crash. I replied publicly, got them to email me, and walked through the fix. They updated the review to four stars.'],
    criterionScores: [
      { criterionKey: 'support_experience', applicantScore: 6, maxScore: 10, confidence: 86, evidence: 'Eighteen months of consumer app support; question complexity self-described as low.', strengths: ['Genuine support tenure'], gaps: ['Consumer rather than B2B', 'Shallow problem complexity'] },
      { criterionKey: 'written_communication', applicantScore: 7, maxScore: 10, confidence: 76, evidence: 'Competent and clear, though the writing sample is brief and lightly detailed.', strengths: ['Handled a public reply well'], gaps: ['Thin writing sample'] },
      { criterionKey: 'problem_ownership', applicantScore: 7, maxScore: 10, confidence: 74, evidence: 'Moved a public complaint into a private channel and saw the fix through to a review update.', strengths: ['Converted a public complaint into a resolution'], gaps: ['Single, relatively simple example'] },
      { criterionKey: 'tooling', applicantScore: 5, maxScore: 10, confidence: 70, evidence: 'Email and app store console only; no helpdesk platform named.', strengths: [], gaps: ['No helpdesk platform'] },
    ],
  },
  {
    firstName: 'Jakub',
    lastName: 'Nowak',
    email: 'jakub.nowak@example.com',
    phone: null,
    score: 58,
    coverLetterText: 'I am a recent graduate with a year of part-time work on a university IT help desk. I am organised, I learn fast, and I would like to build a career in customer support.',
    answers: ['Less than 1 year', 'A lecturer could not access her files before a class. I stayed on the phone with her until she was in, even though my shift had ended.'],
    criterionScores: [
      { criterionKey: 'support_experience', applicantScore: 3, maxScore: 10, confidence: 90, evidence: 'One year part-time on a university IT help desk; no commercial or B2B product support.', strengths: ['Some help desk exposure'], gaps: ['Below the 2-year requirement', 'No commercial support experience'] },
      { criterionKey: 'written_communication', applicantScore: 6, maxScore: 10, confidence: 72, evidence: 'Clear but generic; relies on stock phrases such as "organised" and "learn fast" without evidence.', strengths: ['Correct and readable'], gaps: ['Unsupported claims', 'Little distinct voice'] },
      { criterionKey: 'problem_ownership', applicantScore: 7, maxScore: 10, confidence: 70, evidence: 'Stayed past the end of a shift to finish resolving an urgent access problem.', strengths: ['Willing to see it through'], gaps: ['Low-complexity example'] },
      { criterionKey: 'tooling', applicantScore: 4, maxScore: 10, confidence: 74, evidence: 'University help desk systems only.', strengths: ['Some ticketing exposure'], gaps: ['No commercial helpdesk platform'] },
    ],
  },
  {
    firstName: 'Laura',
    lastName: 'Fitzgerald',
    email: 'laura.fitzgerald@example.com',
    phone: '+44 7700 900918',
    score: 41,
    coverLetterText: 'Experienced administrator seeking a new challenge. I am a people person with excellent communication skills and a strong work ethic. I am confident I would be an asset to your team.',
    answers: ['Less than 1 year', 'I have always had good relationships with the people I work with and I believe communication is key.'],
    criterionScores: [
      { criterionKey: 'support_experience', applicantScore: 2, maxScore: 10, confidence: 88, evidence: 'Administrative background with no support role described.', strengths: [], gaps: ['No customer support experience', 'Does not meet the 2-year minimum'] },
      { criterionKey: 'written_communication', applicantScore: 4, maxScore: 10, confidence: 82, evidence: 'Entirely generic. "People person", "strong work ethic" and "communication is key" carry no specific information.', strengths: ['No errors'], gaps: ['Stock phrasing throughout', 'No concrete example given'] },
      { criterionKey: 'problem_ownership', applicantScore: 2, maxScore: 10, confidence: 85, evidence: 'The ownership question was not actually answered — no situation, action or outcome described.', strengths: [], gaps: ['Non-answer to a direct question'] },
      { criterionKey: 'tooling', applicantScore: 2, maxScore: 10, confidence: 80, evidence: 'No tools of any kind mentioned.', strengths: [], gaps: ['No helpdesk tooling'] },
    ],
  },
  {
    firstName: 'Ryan',
    lastName: 'Kowalczyk',
    email: 'ryan.kowalczyk@example.com',
    phone: null,
    score: 33,
    coverLetterText: 'Interested in the position. Available to start immediately. CV attached.',
    answers: ['Less than 1 year', 'N/A'],
    criterionScores: [
      { criterionKey: 'support_experience', applicantScore: 2, maxScore: 10, confidence: 70, evidence: 'No experience described anywhere in the application.', strengths: [], gaps: ['Nothing to assess'] },
      { criterionKey: 'written_communication', applicantScore: 2, maxScore: 10, confidence: 86, evidence: 'Three sentences, none specific to this role.', strengths: [], gaps: ['No effort or tailoring', 'Nothing demonstrating written skill'] },
      { criterionKey: 'problem_ownership', applicantScore: 1, maxScore: 10, confidence: 88, evidence: 'Answered the ownership question with "N/A".', strengths: [], gaps: ['Declined to answer'] },
      { criterionKey: 'tooling', applicantScore: 2, maxScore: 10, confidence: 72, evidence: 'No tools mentioned.', strengths: [], gaps: ['Nothing stated'] },
    ],
  },
]
