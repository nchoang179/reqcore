import { describe, expect, it } from 'vitest'

import {
  APPLICATION_DETAIL_TABS,
  parseApplicationDetailTab,
} from '../../shared/application-detail-tabs'

/**
 * `?tab=` reaches the detail view straight from the URL bar, so the parser is
 * the only thing standing between a typo and a component rendering no content.
 */
describe('parseApplicationDetailTab', () => {
  it('accepts every real tab', () => {
    for (const tab of APPLICATION_DETAIL_TABS) {
      expect(parseApplicationDetailTab(tab)).toBe(tab)
    }
  })

  it('deep-links the dashboard reply card to the conversation', () => {
    expect(parseApplicationDetailTab('inbox')).toBe('inbox')
  })

  it('falls back to overview for anything unrecognised', () => {
    // Repeated `?tab=` gives Vue Router an array, not a string.
    for (const value of ['', 'Inbox', 'nope', undefined, null, 42, ['inbox']]) {
      expect(parseApplicationDetailTab(value)).toBe('overview')
    }
  })
})
