/**
 * Display labels for `sourceChannelEnum`.
 *
 * Single source of truth: this map was previously copy-pasted into each
 * source-tracking page and had already drifted apart between them.
 * Keep it in sync with `sourceChannelEnum` in server/database/schema/app.ts.
 */
export const SOURCE_CHANNEL_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
  glassdoor: 'Glassdoor',
  ziprecruiter: 'ZipRecruiter',
  monster: 'Monster',
  handshake: 'Handshake',
  angellist: 'AngelList',
  wellfound: 'Wellfound',
  dice: 'Dice',
  stackoverflow: 'Stack Overflow',
  weworkremotely: 'We Work Remotely',
  remoteok: 'Remote OK',
  builtin: 'Built In',
  hired: 'Hired',
  lever: 'Lever',
  greenhouse_board: 'Greenhouse',
  google_jobs: 'Google Jobs',
  facebook: 'Facebook',
  twitter: 'X / Twitter',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  reddit: 'Reddit',
  whatsapp: 'WhatsApp',
  referral: 'Referral',
  career_site: 'Career Site',
  email: 'Email',
  event: 'Event',
  agency: 'Agency',
  direct: 'Direct',
  other: 'Other',
  custom: 'Custom',
  // Aggregators fed automatically by /jobs.xml
  jooble: 'Jooble',
  adzuna: 'Adzuna',
  careerjet: 'Careerjet',
  talent_com: 'Talent.com',
  jobsora: 'Jobsora',
  jora: 'Jora',
  whatjobs: 'WhatJobs',
}

/** Falls back to the raw channel key so an unmapped value is still readable. */
export function sourceChannelLabel(channel: string): string {
  return SOURCE_CHANNEL_LABELS[channel] ?? channel
}
