import { describe, expect, it } from 'vitest'
import { selectTopApplicationsPerStatus } from '../../server/scripts/seed-data/top-applications'

describe('demo application selection', () => {
  it('keeps only the three highest scores in every status', () => {
    const applications = [
      { candidateIndex: 1, status: 'new', score: 72 },
      { candidateIndex: 2, status: 'screening', score: 84 },
      { candidateIndex: 3, status: 'new', score: 91 },
      { candidateIndex: 4, status: 'new', score: 88 },
      { candidateIndex: 5, status: 'screening', score: 79 },
      { candidateIndex: 6, status: 'new', score: 75 },
      { candidateIndex: 7, status: 'screening', score: 90 },
      { candidateIndex: 8, status: 'screening', score: 81 },
    ]

    expect(selectTopApplicationsPerStatus(applications, 3)).toEqual([
      applications[1],
      applications[2],
      applications[3],
      applications[5],
      applications[6],
      applications[7],
    ])
  })

  it('puts unscored applications after scored applications', () => {
    const applications = [
      { candidateIndex: 1, status: 'new' },
      { candidateIndex: 2, status: 'new', score: 0 },
      { candidateIndex: 3, status: 'new', score: 50 },
    ]

    expect(selectTopApplicationsPerStatus(applications, 2)).toEqual([
      applications[1],
      applications[2],
    ])
  })
})
