/**
 * Tabs on the application detail view.
 *
 * Shared so deep links can name a tab: the page validates `?tab=` against this
 * list before handing it to ApplicationDetail, which keeps an unknown or
 * hand-edited value from putting the component into a state with no content.
 */
export const APPLICATION_DETAIL_TABS = [
  'overview',
  'inbox',
  'cover-letter',
  'interviews',
  'documents',
  'responses',
  'ai-analysis',
  'timeline',
  'properties',
  'notes',
] as const

export type ApplicationDetailTab = typeof APPLICATION_DETAIL_TABS[number]

export function parseApplicationDetailTab(value: unknown): ApplicationDetailTab {
  return typeof value === 'string' && (APPLICATION_DETAIL_TABS as readonly string[]).includes(value)
    ? value as ApplicationDetailTab
    : 'overview'
}
