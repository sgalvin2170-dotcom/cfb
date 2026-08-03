// Minimal team-name reconciliation for the CFBD <-> ESPN join (both already
// have stable IDs, so this is just a fuzzy name match). Sources that only
// publish free-text team names (Sagarin, TeamRankings, FEI, PredictionTracker)
// will need the fuller `team_aliases` table this schema already has room for
// — this normalize/startsWith heuristic is a starting point, not the final
// answer for those messier sources.
export function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function findBestMatch<T>(
  targetSchool: string,
  candidates: Map<string, T>,
): T | undefined {
  const target = normalize(targetSchool);
  if (candidates.has(target)) return candidates.get(target);

  for (const [key, value] of candidates) {
    if (key.startsWith(target) || target.startsWith(key)) return value;
  }
  return undefined;
}
