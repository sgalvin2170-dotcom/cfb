// Minimal team-name reconciliation for the CFBD <-> ESPN join (both already
// have stable IDs, so this is just a fuzzy name match). Sources that only
// publish free-text team names (Sagarin, TeamRankings, FEI, PredictionTracker)
// will need the fuller `team_aliases` table this schema already has room for
// — this normalize/startsWith heuristic is a starting point, not the final
// answer for those messier sources.
function decodeHtmlEntities(name: string): string {
  return name
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

export function normalize(name: string): string {
  return decodeHtmlEntities(name)
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
  hawaii: 'hawai i', // CFBD spells it "Hawai'i"; FEI spells it "Hawaii"
  'appalachian state': 'app state', // CFBD abbreviates to "App State"

  // TeamRankings/ThePredictionTracker abbreviate heavily (space-separated on
  // TeamRankings, period-separated on ThePredictionTracker — normalize()
  // strips punctuation either way, so one alias set covers both). Directional
  // prefixes ("E", "W", "N", "S", "C") are genuinely ambiguous — CFBD itself
  // is inconsistent about "East" vs "Eastern" / "North" vs "Northern" per
  // school — so these can't be handled by a general rule and are listed
  // individually. Trailing "St"/"St." -> "State" *is* handled generally, see
  // the fallback in findBestMatch below.
  'j madison': 'james madison',
  's florida': 'south florida',
  'e carolina': 'east carolina',
  'w michigan': 'western michigan',
  'western mich': 'western michigan',
  'w kentucky': 'western kentucky',
  'n texas': 'north texas',
  's alabama': 'south alabama',
  'c michigan': 'central michigan',
  'central mich': 'central michigan',
  'coastal car': 'coastal carolina',
  'e michigan': 'eastern michigan',
  'eastern mich': 'eastern michigan',
  'n illinois': 'northern illinois',
  'northern ill': 'northern illinois',
  'middle tenn': 'middle tennessee',
  umass: 'massachusetts',
  'west va': 'west virginia',
  'san jose st': 'san jose state', // "San José State" loses its accent via normalize()
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

// "Penn St" / "Ball St" / "NC St." (after normalize() strips the period) all
// abbreviate a trailing "State" the same unambiguous way — unlike the
// directional prefixes above, this one general rule covers a couple dozen
// schools without needing an alias per team.
function expandTrailingSt(normalized: string): string | undefined {
  return normalized.endsWith(' st') ? `${normalized.slice(0, -3)} state` : undefined;
}

export function findBestMatch<T>(
  targetSchool: string,
  candidates: Map<string, T>,
): T | undefined {
  const normalized = normalize(targetSchool);
  const target = MANUAL_ALIASES[normalized] ?? normalized;
  if (candidates.has(target)) return candidates.get(target);

  const stExpanded = expandTrailingSt(target);
  if (stExpanded && candidates.has(stExpanded)) return candidates.get(stExpanded);

  let best: { key: string; value: T } | undefined;
  for (const [key, value] of candidates) {
    if (!isWordPrefix(target, key) && !isWordPrefix(key, target)) continue;
    if (!best || Math.abs(key.length - target.length) < Math.abs(best.key.length - target.length)) {
      best = { key, value };
    }
  }
  return best?.value;
}
