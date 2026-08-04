// Minimal team-name reconciliation for the CFBD <-> ESPN join (both already
// have stable IDs, so this is just a fuzzy name match). Sources that only
// publish free-text team names (Sagarin, TeamRankings, FEI, PredictionTracker)
// will need the fuller `team_aliases` table this schema already has room for
// — this normalize/startsWith heuristic is a starting point, not the final
// answer for those messier sources.
export function normalize(name: string): string {
  return name
    .normalize('NFD')
    // Strip combining diacritical marks (e.g. "José" -> "Jose") before the
    // alnum filter below, which would otherwise just delete "é" outright and
    // merge "Jos" + "State" into a string that no longer matches "Jose State".
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Known naming divergences that the generic normalize+startsWith heuristic
// can't bridge (no shared substring at all). Keyed by normalized source name.
const MANUAL_ALIASES: Record<string, string> = {
  'southern california': 'usc',
  mississippi: 'ole miss',
  connecticut: 'uconn',
  'louisianamonroe ulm': 'ul monroe',
  'louisiana monroe': 'ul monroe',
};

// A word-boundary prefix check, not a raw startsWith: "michigan" is a raw
// prefix of both "michigan wolverines" AND "michigan state spartans", and a
// naive startsWith match picked whichever came first in Map iteration order
// — silently mismatching Michigan/Michigan State, Arizona/Arizona State,
// Texas/Texas A&M, Utah/Utah State, and Miami/Miami (OH) to the same ESPN
// row. Word-boundary prefixing still leaves both as valid candidates (both
// checks pass either direction), so among all boundary-respecting matches we
// take the one with the smallest length difference — the tightest match.
function isWordPrefix(prefix: string, full: string): boolean {
  return full === prefix || full.startsWith(prefix + ' ');
}

export function findBestMatch<T>(
  targetSchool: string,
  candidates: Map<string, T>,
): T | undefined {
  const target = MANUAL_ALIASES[normalize(targetSchool)] ?? normalize(targetSchool);
  if (candidates.has(target)) return candidates.get(target);

  let best: { key: string; value: T } | undefined;
  for (const [key, value] of candidates) {
    if (!isWordPrefix(target, key) && !isWordPrefix(key, target)) continue;
    if (!best || Math.abs(key.length - target.length) < Math.abs(best.key.length - target.length)) {
      best = { key, value };
    }
  }
  return best?.value;
}
