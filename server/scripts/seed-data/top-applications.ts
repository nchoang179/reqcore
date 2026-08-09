export interface ScoredApplicationFixture {
  candidateIndex: number;
  status: string;
  score?: number;
}

/**
 * Select the highest-scored fixtures in each status while retaining their
 * original order in the returned collection.
 */
export function selectTopApplicationsPerStatus<
  TApplication extends ScoredApplicationFixture,
>(
  applications: readonly TApplication[],
  limit: number,
): TApplication[] {
  const selected = new Set<TApplication>();
  const byStatus = new Map<string, TApplication[]>();

  for (const application of applications) {
    const statusApplications = byStatus.get(application.status) ?? [];
    statusApplications.push(application);
    byStatus.set(application.status, statusApplications);
  }

  for (const statusApplications of byStatus.values()) {
    const highestScoring = [...statusApplications]
      .sort(
        (left, right) =>
          (right.score ?? Number.NEGATIVE_INFINITY) -
            (left.score ?? Number.NEGATIVE_INFINITY) ||
          left.candidateIndex - right.candidateIndex,
      )
      .slice(0, limit);

    for (const application of highestScoring) {
      selected.add(application);
    }
  }

  return applications.filter((application) => selected.has(application));
}
