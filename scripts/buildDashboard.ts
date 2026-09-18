// Generates a self-contained static HTML snapshot of the three main app
// screens (CFB Games, Best Bets, Post-Game Analysis) to
// CFB_Dashboard.html — openable by double-click, no dev server needed.
// Reuses the same lib/ modules the live app renders with (grading,
// bestBets edge math, box score aggregation) so the snapshot's numbers
// can never silently drift from what localhost shows. Run via `npm run
// dashboard`, or automatically at the end of the daily ETL (see index.ts).
import * as fs from 'fs';

import { db } from './etl/instantAdmin';
import { env } from './etl/env';
import { gradeAts, gradeTotal, gradeMoneyline, type Grade } from '../lib/grading';
import { aggregateBoxScore, type BoxScoreAgg } from '../lib/boxScoreAgg';
import { atsEdge, atsStrength, totalEdge, totalStrength, mlStrength } from '../lib/bestBets';
import { runMonteCarlo, TRIALS } from '../lib/monteCarlo';

const MODEL_VERSION = 'v2-fitted';
const DECAY_SCHEDULE = [
  { week: 1, preseasonPct: 100 },
  { week: 2, preseasonPct: 75 },
  { week: 3, preseasonPct: 50 },
  { week: 4, preseasonPct: 25 },
];

const OUT_PATH = 'C:\\Users\\Steven Galvin\\CFB_Project\\CFB_Dashboard.html';
const ET_ZONE = 'America/New_York';
const ML_HIGH_EDGE = 0.1;

// ---------- shared formatting (mirrors lib/format.ts) ----------
function formatKickoff(startDate: string): string {
  return (
    new Date(startDate).toLocaleString('en-US', {
      timeZone: ET_ZONE,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }) + ' ET'
  );
}
function formatKickoffTime(startDate: string): string {
  return new Date(startDate).toLocaleString('en-US', { timeZone: ET_ZONE, hour: 'numeric', minute: '2-digit' }) + ' ET';
}
function etDateKey(startDate: string): string {
  return new Date(startDate).toLocaleDateString('en-CA', { timeZone: ET_ZONE });
}
function formatDateHeader(startDate: string): string {
  return new Date(startDate).toLocaleDateString('en-US', { timeZone: ET_ZONE, weekday: 'long', month: 'short', day: 'numeric' });
}
function formatSpread(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
}
function formatTotal(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(1);
}
function confidenceColor(confidence: string | undefined | null): string {
  switch (confidence) {
    case 'high':
      return '#1a7f37';
    case 'medium':
      return '#9a6700';
    default:
      return '#57606a';
  }
}
function gradeColor(grade: Grade | undefined): string {
  switch (grade) {
    case 'win':
      return '#1a7f37';
    case 'loss':
      return '#cf222e';
    case 'push':
      return '#9a6700';
    default:
      return '#57606a';
  }
}
function esc(s: string | undefined | null): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function mlConfidenceLevel(mlEdge: number | null | undefined): 'high' | 'medium' | undefined {
  if (mlEdge == null) return undefined;
  return mlStrength(mlEdge) >= 1 ? 'high' : 'medium';
}
function teamLabel(team: any): string {
  return team?.abbreviation ?? team?.school ?? 'TBD';
}

// ---------- Game Detail helpers (mirrors app/game/[id].tsx) ----------
function fmtOrDash(value: number | undefined | null, fmt: (v: number) => string): string {
  return value != null ? fmt(value) : '—';
}
function formatRecord(wins?: number, losses?: number, ties?: number): string {
  if (wins == null || losses == null) return '—';
  return ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}
function positionBreakdown(entries: any[]): string {
  if (entries.length === 0) return '—';
  const counts = new Map<string, number>();
  for (const e of entries) {
    const pos = e.position ?? '?';
    counts.set(pos, (counts.get(pos) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([pos, count]) => `${count} ${pos}`)
    .join(', ');
}
function latestPerMetric(ratings: any[]): any[] {
  const latest = new Map<string, any>();
  for (const r of ratings ?? []) {
    const key = `${r.source}:${r.metricName}`;
    const existing = latest.get(key);
    if (!existing || new Date(r.scrapedAt).getTime() > new Date(existing.scrapedAt).getTime()) {
      latest.set(key, r);
    }
  }
  return Array.from(latest.values());
}
function detailRow(label: string, value: string | undefined): string {
  return `<div class="d-row"><span class="d-row-label">${esc(label)}</span><span class="d-row-value">${esc(value ?? '—')}</span></div>`;
}

// ================= SECTION 1: CFB Games =================
async function buildGamesSection(): Promise<string> {
  // Team-level detail (ratings/coaching/recruiting/portal) is fetched ONCE
  // here, flat across all ~138 teams, rather than nested under every game —
  // nesting it under `games` would refetch each team's data once per game
  // it plays (~14x over a season), the same unbounded-fan-out shape that
  // caused ensemble.ts's InstantDB query-cost timeouts (see that file's
  // 2026-08-21/2026-09-06 comments). A flat per-team query is O(teams), not
  // O(games), regardless of how many games reference the same team.
  const [{ games }, { teams }, { model_weights }] = await Promise.all([
    (db as any).query({
      games: {
        $: { where: { season: env.season }, order: { startDate: 'asc' } },
        homeTeam: { pollRankings: { $: { where: { season: env.season } } } },
        awayTeam: { pollRankings: { $: { where: { season: env.season } } } },
        venue: {},
        ensemblePicks: { $: { order: { computedAt: 'desc' } } },
        weatherForecasts: {},
        odds: {},
      },
    }),
    (db as any).query({
      teams: {
        ratings: { $: { where: { season: env.season } } },
        talent: { $: { where: { season: env.season } } },
        coaches: {},
        preseasonScores: { $: { where: { season: env.season } } },
        recruitingClasses: { $: { where: { season: env.season } } },
        rosterContinuity: { $: { where: { season: env.season } } },
        portalIn: { $: { where: { season: env.season } } },
        portalOut: { $: { where: { season: env.season } } },
      },
    }),
    (db as any).query({
      model_weights: { $: { where: { modelVersion: MODEL_VERSION, sourceName: 'team_score_sigma' } } },
    }),
  ]);

  const teamById = new Map<string, any>((teams as any[]).map((t) => [t.id, t]));
  const scoreSigma = (model_weights as any[])?.[0]?.weight as number | undefined;

  const allGames = (games as any[]).map((g) => {
    const pick = g.ensemblePicks?.[0];
    const pollRankFor = (team: any) => team?.pollRankings?.find((pr: any) => pr.week === g.week)?.rank;
    return {
      id: g.id,
      week: g.week,
      startDate: g.startDate,
      venue: g.venue,
      weather: g.weatherForecasts?.[0],
      openLine: g.odds?.[0],
      homeTeam: g.homeTeam
        ? {
            id: g.homeTeam.id,
            school: g.homeTeam.school,
            abbreviation: g.homeTeam.abbreviation,
            logoUrl: g.homeTeam.logoUrl,
            pollRank: pollRankFor(g.homeTeam),
          }
        : undefined,
      awayTeam: g.awayTeam
        ? {
            id: g.awayTeam.id,
            school: g.awayTeam.school,
            abbreviation: g.awayTeam.abbreviation,
            logoUrl: g.awayTeam.logoUrl,
            pollRank: pollRankFor(g.awayTeam),
          }
        : undefined,
      dome: g.venue?.dome ?? false,
      windMph: g.weatherForecasts?.[0]?.windMph,
      pick,
    };
  });

  const weeks = Array.from(new Set(allGames.map((g) => g.week))).sort((a, b) => a - b);

  function renderCoachingTeam(label: string, team: any): string {
    const coach = team?.coaches?.[0];
    return `<div class="d-team-block"><div class="d-team-title">${esc(label)}</div>${
      coach
        ? detailRow('Head coach', `${coach.firstName} ${coach.lastName}`) +
          detailRow('Years at school', `${coach.yearsAtSchool}`) +
          detailRow('Record at school', formatRecord(coach.wins, coach.losses, coach.ties)) +
          detailRow('Career record', formatRecord(coach.careerWins, coach.careerLosses, coach.careerTies))
        : `<div class="d-dim">No coaching data available yet.</div>`
    }</div>`;
  }

  function renderPreseasonWeightsTeam(label: string, team: any): string {
    const score = team?.preseasonScores?.[0];
    return `<div class="d-team-block"><div class="d-team-title">${esc(label)}</div>${
      score
        ? detailRow('Roster Talent Score', `${score.talentPercentile.toFixed(0)}th percentile`) +
          detailRow('Returning Production', score.returningProductionScore.toFixed(0)) +
          detailRow('Transfer Portal', score.transferPortalScore.toFixed(0)) +
          detailRow('Recruiting', score.recruitingScore.toFixed(0)) +
          detailRow('Preseason Roster Score', score.rosterScore.toFixed(1))
        : `<div class="d-dim">No preseason roster data available yet.</div>`
    }</div>`;
  }

  function renderRecruitingPortalTeam(label: string, team: any): string {
    const recruiting = team?.recruitingClasses?.[0];
    const continuity = team?.rosterContinuity?.[0];
    const portalIn: any[] = team?.portalIn ?? [];
    const portalOut: any[] = team?.portalOut ?? [];
    const notable = [
      ...portalIn.filter((p) => p.topPortalPlayer).map((p) => ({ ...p, direction: 'in' as const })),
      ...portalOut.filter((p) => p.topPortalPlayer).map((p) => ({ ...p, direction: 'out' as const })),
    ];
    const notableHtml =
      notable.length > 0
        ? `<div class="d-notable"><div class="d-notable-title">Top-100 portal players</div>${notable
            .map(
              (p) =>
                `<div class="d-notable-item"><span class="${p.direction === 'in' ? 'd-arrow-in' : 'd-arrow-out'}">${p.direction === 'in' ? '↑' : '↓'}</span> ${esc(p.firstName)} ${esc(p.lastName)} (${esc(p.position ?? '?')})${p.direction === 'in' ? ` from ${esc(p.originName ?? 'the portal')}` : ` to ${esc(p.destinationName ?? 'the portal')}`}${p.portalRank ? ` — #${p.portalRank} in portal` : ''}</div>`,
            )
            .join('')}</div>`
        : '';
    return `<div class="d-team-block"><div class="d-team-title">${esc(label)}</div>
      ${detailRow('Recruiting class', recruiting ? `#${recruiting.rank ?? '—'} nationally (${recruiting.points?.toFixed(1) ?? '—'} pts)` : 'Not yet ranked')}
      ${recruiting ? detailRow('5-star / 4-star signees', `${recruiting.fiveStars} / ${recruiting.fourStars}`) : ''}
      ${detailRow('Returning players (off / def)', continuity ? `${continuity.offenseReturning} / ${continuity.defenseReturning}` : 'Not yet published')}
      ${detailRow('Portal — incoming', `${portalIn.length} (${positionBreakdown(portalIn)})`)}
      ${detailRow('Portal — outgoing', `${portalOut.length} (${positionBreakdown(portalOut)})`)}
      ${notableHtml}
    </div>`;
  }

  function renderRatingsSection(label: string, team: any): string {
    const talent = team?.talent?.[0];
    const ratings = latestPerMetric(team?.ratings ?? []);
    const body =
      ratings.length === 0
        ? `<div class="d-dim">No ratings ingested yet for this team.</div>`
        : ratings.map((r) => detailRow(`${r.source} · ${r.metricName}`, r.value?.toFixed(2))).join('');
    return `<div class="d-section"><div class="d-section-title">Per-source ratings — ${esc(label)}</div>${
      talent ? detailRow('Talent composite', talent.talentScore?.toFixed(1)) : ''
    }${body}</div>`;
  }

  function renderDetail(g: any): string {
    const pick = g.pick;
    const homeTeamFull = teamById.get(g.homeTeam?.id);
    const awayTeamFull = teamById.get(g.awayTeam?.id);

    const simulation =
      pick && pick.mcMedianHomeScore != null
        ? {
            trials: TRIALS,
            sigma: pick.mcSigma ?? scoreSigma ?? 0,
            homeWinProb: pick.mcHomeWinProb as number,
            awayWinProb: pick.mcAwayWinProb as number,
            homeCoverProb: pick.mcHomeCoverProb ?? undefined,
            awayCoverProb: pick.mcAwayCoverProb ?? undefined,
            overProb: pick.mcOverProb ?? undefined,
            underProb: pick.mcUnderProb ?? undefined,
            medianHomeScore: pick.mcMedianHomeScore as number,
            medianAwayScore: pick.mcMedianAwayScore as number,
          }
        : pick && pick.predictedTotal != null && scoreSigma != null
          ? runMonteCarlo({
              gameId: g.id,
              homeMean: (pick.predictedTotal + pick.adjustedPredictedMargin) / 2,
              awayMean: (pick.predictedTotal - pick.adjustedPredictedMargin) / 2,
              sigma: scoreSigma,
              windMph: g.windMph,
              marketHomeSpread: pick.marketHomeSpread,
              marketTotal: pick.marketTotal,
            })
          : undefined;

    const venueLine = g.venue
      ? `${esc(g.venue.name)}${g.venue.city ? ` · ${esc(g.venue.city)}, ${esc(g.venue.state ?? '')}` : ''}${g.venue.capacity ? ` · Capacity ${g.venue.capacity.toLocaleString()}` : ''}${g.venue.dome ? ' · Dome' : ''}${g.venue.grass === true ? ' · Grass' : g.venue.grass === false ? ' · Turf' : ''}`
      : '';

    const weatherSection = g.weather
      ? `<div class="d-section"><div class="d-section-title">Weather at kickoff</div>
          ${detailRow('Temperature', fmtOrDash(g.weather.tempF, (v) => `${Math.round(v)}°F`))}
          ${detailRow('Wind', fmtOrDash(g.weather.windMph, (v) => `${Math.round(v)} mph${g.weather.windDir ? ` ${g.weather.windDir}` : ''}`))}
          ${detailRow('Precipitation chance', fmtOrDash(g.weather.precipProb, (v) => `${Math.round(v)}%`))}
        </div>`
      : '';

    const picksSection = `<div class="d-section"><div class="d-section-title">Ensemble Picks</div>${
      pick
        ? detailRow('Spread (ATS)', `${pick.atsPick ?? '—'} (market ${formatSpread(pick.marketHomeSpread)})`) +
          detailRow('Opening spread', formatSpread(g.openLine?.openHomeSpread)) +
          detailRow('Total (O/U)', `${pick.totalPick ?? '—'} (market ${pick.marketTotal?.toFixed(1) ?? '—'}, model ${pick.predictedTotal?.toFixed(1) ?? '—'})`) +
          detailRow('Opening total (O/U)', g.openLine?.openOverUnder != null ? g.openLine.openOverUnder.toFixed(1) : '—') +
          detailRow('Moneyline', pick.mlPick ?? '—') +
          detailRow('Model margin (raw / adjusted)', `${formatSpread(pick.rawPredictedMargin)} / ${formatSpread(pick.adjustedPredictedMargin)}`) +
          (pick.adjustmentNotes ? detailRow('Adjustment notes', pick.adjustmentNotes) : '')
        : `<div class="d-dim">No ensemble pick computed yet for this game.</div>`
    }</div>`;

    const mcSection = `<div class="d-section"><div class="d-section-title">Monte Carlo Simulation</div>${
      simulation
        ? detailRow(
            'Win probability',
            `${g.homeTeam?.school ?? 'Home'} ${(simulation.homeWinProb * 100).toFixed(0)}% / ${g.awayTeam?.school ?? 'Away'} ${(simulation.awayWinProb * 100).toFixed(0)}%`,
          ) +
          (simulation.homeCoverProb != null
            ? detailRow(
                `Covers ${formatSpread(pick.marketHomeSpread)}`,
                `${g.homeTeam?.school ?? 'Home'} ${(simulation.homeCoverProb * 100).toFixed(0)}% / ${g.awayTeam?.school ?? 'Away'} ${(simulation.awayCoverProb! * 100).toFixed(0)}%`,
              )
            : '') +
          (simulation.overProb != null
            ? detailRow('Over / Under', `Over ${(simulation.overProb * 100).toFixed(0)}% / Under ${(simulation.underProb! * 100).toFixed(0)}%`)
            : '') +
          detailRow(
            'Median simulated score',
            `${g.homeTeam?.school ?? 'Home'} ${simulation.medianHomeScore} – ${g.awayTeam?.school ?? 'Away'} ${simulation.medianAwayScore}`,
          ) +
          detailRow('Simulation detail', `${simulation.trials.toLocaleString()} trials, σ=${simulation.sigma.toFixed(1)} pts/team`)
        : `<div class="d-dim">Not enough data to simulate this game yet.</div>`
    }</div>`;

    const decayList = DECAY_SCHEDULE.map(
      ({ week, preseasonPct }) =>
        `<div class="d-notable-item${g.week === week ? ' d-decay-current' : ''}">${g.week === week ? '▶ ' : ''}Game ${week}: ${preseasonPct}% preseason roster / ${100 - preseasonPct}% on-field data</div>`,
    ).join('');
    const decayExtra =
      g.week > DECAY_SCHEDULE.length
        ? `<div class="d-notable-item d-decay-current">▶ Game ${g.week}: 0% preseason roster / 100% on-field data</div>`
        : '';

    return `<div class="detail-panel">
      ${venueLine ? `<div class="d-venue">${venueLine}</div>` : ''}
      ${weatherSection}
      ${picksSection}
      ${mcSection}
      <div class="d-section"><div class="d-section-title">Coaching</div>${renderCoachingTeam(g.awayTeam?.school ?? 'Away', awayTeamFull)}${renderCoachingTeam(g.homeTeam?.school ?? 'Home', homeTeamFull)}</div>
      <div class="d-section"><div class="d-section-title">Preseason Roster Weights</div>${renderPreseasonWeightsTeam(g.awayTeam?.school ?? 'Away', awayTeamFull)}${renderPreseasonWeightsTeam(g.homeTeam?.school ?? 'Home', homeTeamFull)}<div class="d-notable"><div class="d-notable-title">Weight decay by game</div>${decayList}${decayExtra}</div><div class="d-dim">Reference only — not yet blended into the Ensemble Picks above.</div></div>
      <div class="d-section"><div class="d-section-title">Recruiting and Portal Transfers</div>${renderRecruitingPortalTeam(g.awayTeam?.school ?? 'Away', awayTeamFull)}${renderRecruitingPortalTeam(g.homeTeam?.school ?? 'Home', homeTeamFull)}</div>
      ${renderRatingsSection(g.awayTeam?.school ?? 'Away', awayTeamFull)}
      ${renderRatingsSection(g.homeTeam?.school ?? 'Home', homeTeamFull)}
    </div>`;
  }

  function renderTeamRow(team: any, market: number | undefined | null, model: number | undefined | null, hasMarket: boolean): string {
    const logo = team?.logoUrl ? `<img class="logo" src="${esc(team.logoUrl)}" alt="" />` : `<span class="logo logo-fallback"></span>`;
    const rank = team?.pollRank != null ? `<span class="rank">#${team.pollRank}</span>` : '';
    const nums = hasMarket
      ? `<span class="num">${formatSpread(market)}</span><span class="num num-model">${formatSpread(model)}</span>`
      : '';
    return `<div class="team-row">${logo}${rank}<span class="team-name">${esc(teamLabel(team))}</span><span class="num-cols">${nums}</span></div>`;
  }

  function renderCard(g: any): string {
    const pick = g.pick;
    const hasMarket = pick?.marketHomeSpread != null;
    const homeMarket = pick?.marketHomeSpread;
    const awayMarket = pick?.marketHomeSpread != null ? -pick.marketHomeSpread : undefined;
    const homeModel = pick?.adjustedPredictedMargin != null ? -pick.adjustedPredictedMargin : undefined;
    const awayModel = pick?.adjustedPredictedMargin;

    const atsTeam = pick?.atsPick === 'home' ? teamLabel(g.homeTeam) : pick?.atsPick === 'away' ? teamLabel(g.awayTeam) : undefined;
    const mlTeam = pick?.mlPick === 'home' ? teamLabel(g.homeTeam) : pick?.mlPick === 'away' ? teamLabel(g.awayTeam) : undefined;
    const mlConfidence = pick?.mlPick ? (pick.mlEdge != null && Math.abs(pick.mlEdge) >= ML_HIGH_EDGE ? 'high' : 'medium') : undefined;

    const tags = [
      g.dome ? '<span class="tag tag-dome">DOME</span>' : '',
      !g.dome && g.windMph != null && g.windMph >= 15 ? `<span class="tag tag-wind">💨${Math.round(g.windMph)}</span>` : '',
    ].join('');

    const colHeaders = hasMarket ? `<span class="col-headers"><span>MKT</span><span>MODEL</span></span>` : '';

    const totalRow =
      pick?.marketTotal == null && pick?.predictedTotal == null
        ? ''
        : `<div class="team-row"><span class="ou-spacer"></span><span class="team-name">O/U</span><span class="num-cols"><span class="num">${formatTotal(pick?.marketTotal)}</span><span class="num num-model">${formatTotal(pick?.predictedTotal)}</span></span></div>`;

    function chip(label: string, value: string | undefined, confidence: string | undefined | null): string {
      const color = confidenceColor(confidence);
      const conf = confidence ? `<span class="chip-conf" style="color:${color}">${confidence.toUpperCase()}</span>` : '';
      return `<span class="chip" style="border-color:${color}">${conf}<span class="chip-text">${label}: ${esc(value ?? 'no-lean')}</span></span>`;
    }

    const picksRow = pick
      ? `<div class="picks-row">${chip('ATS', atsTeam, pick.atsPick ? pick.atsConfidence : undefined)}${chip('Total', pick.totalPick?.toUpperCase(), pick.totalPick ? pick.totalConfidence : undefined)}${chip('ML', mlTeam, mlConfidence)}</div>`
      : `<div class="no-pick">No pick yet — awaiting data</div>`;

    return `<details class="card-details">
      <summary class="card">
        <div class="header-row"><span class="kickoff">${formatKickoffTime(g.startDate)}</span><span class="tag-row">${tags}</span>${colHeaders}</div>
        ${renderTeamRow(g.awayTeam, awayMarket, awayModel, hasMarket)}
        ${renderTeamRow(g.homeTeam, homeMarket, homeModel, hasMarket)}
        ${totalRow}
        ${picksRow}
        <div class="expand-hint">Tap for game detail ▾</div>
      </summary>
      ${renderDetail(g)}
    </details>`;
  }

  function renderWeek(week: number): string {
    const weekGames = allGames.filter((g) => g.week === week);
    const byDay = new Map<string, any[]>();
    for (const g of weekGames) {
      const key = etDateKey(g.startDate);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(g);
    }
    const columns = Array.from(byDay.entries())
      .map(
        ([, dayGames]) =>
          `<div class="column"><div class="date-header"><span class="date-dot"></span>${formatDateHeader(dayGames[0].startDate)}</div>${dayGames.map(renderCard).join('')}</div>`,
      )
      .join('');
    return `<div class="week-panel games-week-panel" data-week="${week}" style="display:none"><div class="board">${columns}</div></div>`;
  }

  const weekTabs = weeks
    .map((w, i) => `<button class="week-tab games-week-tab${i === 0 ? ' active' : ''}" data-week="${w}">Week ${w}</button>`)
    .join('');
  const weekPanels = weeks.map(renderWeek).join('');

  return `<div class="week-tabs">${weekTabs}</div>${weekPanels}`;
}

// ================= SECTION 2: Best Bets =================
interface BestBet {
  key: string;
  game: any;
  market: 'ATS' | 'Total' | 'ML';
  pickLabel: string;
  confidence?: string | null;
  strength: number;
  edgeText: string;
  reason: string;
}

function matchupLabel(game: any): string {
  return `${game.awayTeam?.school ?? 'Away'} @ ${game.homeTeam?.school ?? 'Home'}`;
}

function buildBets(games: any[]): BestBet[] {
  const bets: BestBet[] = [];
  for (const game of games) {
    const pick = game.pick;
    if (!pick) continue;
    const matchup = matchupLabel(game);

    if (pick.atsPick && pick.marketHomeSpread != null && pick.adjustedPredictedMargin != null) {
      const edge = atsEdge(pick.adjustedPredictedMargin, pick.marketHomeSpread);
      const team = pick.atsPick === 'home' ? game.homeTeam : game.awayTeam;
      const line = pick.atsPick === 'home' ? pick.marketHomeSpread : -pick.marketHomeSpread;
      bets.push({
        key: `${game.id}-ats`,
        game,
        market: 'ATS',
        pickLabel: `${team?.school ?? pick.atsPick.toUpperCase()} ${formatSpread(line)}`,
        confidence: pick.atsConfidence,
        strength: atsStrength(edge),
        edgeText: `${Math.abs(edge).toFixed(1)} pt edge`,
        reason: `${matchup}: model margin ${formatSpread(pick.adjustedPredictedMargin)} (home) vs market ${formatSpread(pick.marketHomeSpread)}. ${pick.adjustmentNotes ?? ''}`.trim(),
      });
    }
    if (pick.totalPick && pick.marketTotal != null && pick.predictedTotal != null) {
      const edge = totalEdge(pick.predictedTotal, pick.marketTotal);
      bets.push({
        key: `${game.id}-total`,
        game,
        market: 'Total',
        pickLabel: `${pick.totalPick === 'over' ? 'Over' : 'Under'} ${pick.marketTotal.toFixed(1)}`,
        confidence: pick.totalConfidence,
        strength: totalStrength(edge),
        edgeText: `${Math.abs(edge).toFixed(1)} pt edge`,
        reason: `${matchup}: model total ${pick.predictedTotal.toFixed(1)} vs market ${pick.marketTotal.toFixed(1)}. ${pick.adjustmentNotes ?? ''}`.trim(),
      });
    }
    if (pick.mlPick && pick.mlEdge != null) {
      const team = pick.mlPick === 'home' ? game.homeTeam : game.awayTeam;
      const edgePct = Math.abs(pick.mlEdge) * 100;
      bets.push({
        key: `${game.id}-ml`,
        game,
        market: 'ML',
        pickLabel: `${team?.school ?? pick.mlPick.toUpperCase()} ML`,
        confidence: mlStrength(pick.mlEdge) >= 1 ? 'high' : 'medium',
        strength: mlStrength(pick.mlEdge),
        edgeText: `${edgePct.toFixed(1)}% win-prob edge`,
        reason: `${matchup}: model gives ${team?.school ?? pick.mlPick} a ${edgePct.toFixed(1)}pt edge over the market's devigged win probability.`,
      });
    }
  }
  return bets.sort((a, b) => b.strength - a.strength);
}

async function buildBestBetsSection(): Promise<string> {
  const { games } = await (db as any).query({
    games: {
      $: { where: { season: env.season }, order: { startDate: 'asc' } },
      homeTeam: {},
      awayTeam: {},
      ensemblePicks: { $: { order: { computedAt: 'desc' } } },
    },
  } as any);

  const allGames = (games as any[]).map((g) => ({ ...g, pick: g.ensemblePicks?.[0] }));
  const weeks = Array.from(new Set(allGames.map((g) => g.week))).sort((a, b) => a - b);

  function renderBetCard(bet: BestBet, rank: number): string {
    const color = confidenceColor(bet.confidence);
    return `<div class="bb-card">
      <div class="bb-header"><span class="bb-rank">#${rank}</span><span class="bb-market">${bet.market}</span><span class="bb-kickoff">${formatKickoff(bet.game.startDate)}</span></div>
      <div class="bb-pick">${esc(bet.pickLabel)}</div>
      <div class="bb-confidence" style="color:${color}">${bet.confidence?.toUpperCase() ?? '—'} confidence · ${bet.edgeText}</div>
      <div class="bb-reason">${esc(bet.reason)}</div>
    </div>`;
  }

  function renderWeek(week: number): string {
    const weekGames = allGames.filter((g) => g.week === week);
    const topBets = buildBets(weekGames).slice(0, 10);
    const body =
      topBets.length === 0
        ? `<div class="empty">No graded picks yet for this week.</div>`
        : topBets.map((b, i) => renderBetCard(b, i + 1)).join('');
    return `<div class="week-panel bb-week-panel" data-week="${week}" style="display:none">${body}</div>`;
  }

  const weekTabs = weeks
    .map((w, i) => `<button class="week-tab bb-week-tab${i === 0 ? ' active' : ''}" data-week="${w}">Week ${w}</button>`)
    .join('');
  const weekPanels = weeks.map(renderWeek).join('');

  return `<div class="week-tabs">${weekTabs}</div>${weekPanels}`;
}

// ================= SECTION 3: Post-Game Analysis =================
interface Tally {
  wins: number;
  losses: number;
  pushes: number;
}
function tallyBestBets(games: any[]): Tally {
  let wins = 0,
    losses = 0,
    pushes = 0;
  for (const g of games) {
    const pick = g.ensemblePicks?.[0];
    if (!pick) continue;
    const odds = g.odds?.[0];
    for (const [rankField, grade] of [
      [pick.atsBestBetRank, gradeAts(pick.atsPick, g.homePoints, g.awayPoints, odds?.homeSpread)],
      [pick.totalBestBetRank, gradeTotal(pick.totalPick, g.homePoints, g.awayPoints, odds?.overUnder)],
      [pick.mlBestBetRank, gradeMoneyline(pick.mlPick, g.homePoints, g.awayPoints)],
    ] as const) {
      if (rankField == null) continue;
      if (grade === 'win') wins++;
      else if (grade === 'loss') losses++;
      else if (grade === 'push') pushes++;
    }
  }
  return { wins, losses, pushes };
}
type Market = 'ats' | 'total' | 'ml';
function tallyMarket(games: any[], market: Market, level: 'high' | 'medium'): Tally {
  let wins = 0,
    losses = 0,
    pushes = 0;
  for (const g of games) {
    const pick = g.ensemblePicks?.[0];
    if (!pick) continue;
    const odds = g.odds?.[0];
    let grade: Grade | undefined;
    if (market === 'ats' && pick.atsConfidence === level) grade = gradeAts(pick.atsPick, g.homePoints, g.awayPoints, odds?.homeSpread);
    else if (market === 'total' && pick.totalConfidence === level) grade = gradeTotal(pick.totalPick, g.homePoints, g.awayPoints, odds?.overUnder);
    else if (market === 'ml' && mlConfidenceLevel(pick.mlEdge) === level) grade = gradeMoneyline(pick.mlPick, g.homePoints, g.awayPoints);
    if (grade === 'win') wins++;
    else if (grade === 'loss') losses++;
    else if (grade === 'push') pushes++;
  }
  return { wins, losses, pushes };
}
function tallyMonteCarlo(games: any[]): Tally {
  let wins = 0,
    losses = 0;
  for (const g of games) {
    const pick = g.ensemblePicks?.[0];
    if (!pick || pick.mcHomeWinProb == null || g.homePoints == null || g.awayPoints == null) continue;
    const predictedHomeWin = pick.mcHomeWinProb > 0.5;
    const actualHomeWin = g.homePoints > g.awayPoints;
    if (predictedHomeWin === actualHomeWin) wins++;
    else losses++;
  }
  return { wins, losses, pushes: 0 };
}
function computeTeamRecords(games: any[]): Map<string, { wins: number; losses: number }> {
  const records = new Map<string, { wins: number; losses: number }>();
  const bump = (teamId: string | undefined, win: boolean) => {
    if (!teamId) return;
    const r = records.get(teamId) ?? { wins: 0, losses: 0 };
    if (win) r.wins++;
    else r.losses++;
    records.set(teamId, r);
  };
  for (const g of games) {
    if (g.homePoints == null || g.awayPoints == null || g.homePoints === g.awayPoints) continue;
    const homeWon = g.homePoints > g.awayPoints;
    bump(g.homeTeam?.id, homeWon);
    bump(g.awayTeam?.id, !homeWon);
  }
  return records;
}
interface Tallies {
  bestBets: Tally;
  highAts: Tally;
  highTotal: Tally;
  highMl: Tally;
  mediumAts: Tally;
  mediumTotal: Tally;
  mediumMl: Tally;
  monteCarlo: Tally;
}
function computeTallies(games: any[]): Tallies {
  return {
    bestBets: tallyBestBets(games),
    highAts: tallyMarket(games, 'ats', 'high'),
    highTotal: tallyMarket(games, 'total', 'high'),
    highMl: tallyMarket(games, 'ml', 'high'),
    mediumAts: tallyMarket(games, 'ats', 'medium'),
    mediumTotal: tallyMarket(games, 'total', 'medium'),
    mediumMl: tallyMarket(games, 'ml', 'medium'),
    monteCarlo: tallyMonteCarlo(games),
  };
}

async function buildPostGameSection(): Promise<string> {
  const { games } = await (db as any).query({
    games: {
      $: { where: { season: env.season, completed: true }, order: { startDate: 'desc' } },
      homeTeam: { gameStats: {} },
      awayTeam: { gameStats: {} },
      odds: {},
      ensemblePicks: { $: { order: { computedAt: 'desc' } } },
      teamStats: { team: {} },
    },
  } as any);

  const allGames = games as any[];
  const weeks = Array.from(new Set(allGames.map((g) => g.week))).sort((a, b) => a - b);
  const teamRecords = computeTeamRecords(allGames);

  function renderSummaryRow(rowLabel: string, t: Tallies, cumulative: boolean): string {
    const chips = [
      ['Best Bets', t.bestBets],
      ['High ATS', t.highAts],
      ['High O/U', t.highTotal],
      ['High ML', t.highMl],
      ['Medium ATS', t.mediumAts],
      ['Medium O/U', t.mediumTotal],
      ['Medium ML', t.mediumMl],
      ['Monte Carlo', t.monteCarlo],
    ].filter(([, tally]) => (tally as Tally).wins + (tally as Tally).losses + (tally as Tally).pushes > 0) as [string, Tally][];
    if (chips.length === 0) return '';
    const chipHtml = chips
      .map(([label, tally]) => {
        const decided = tally.wins + tally.losses;
        const pct = decided > 0 ? ((tally.wins / decided) * 100).toFixed(1) : null;
        return `<div class="season-chip"><span class="season-chip-label">${label}</span><span class="season-chip-value">${tally.wins}-${tally.losses}${tally.pushes > 0 ? `-${tally.pushes}` : ''}${pct != null ? ` (${pct}%)` : ''}</span></div>`;
      })
      .join('');
    return `<div class="season-banner${cumulative ? ' cumulative' : ''}"><span class="season-row-label">${rowLabel}</span>${chipHtml}</div>`;
  }

  function numberCell(label: string, value: string): string {
    return `<div class="number-cell"><span class="number-cell-label">${label}</span><span class="number-cell-value">${value}</span></div>`;
  }

  function selectionRow(
    label: string,
    confidence: string | undefined,
    pickLabel: string | undefined,
    model: string,
    market: string,
    actual: string,
    grade: Grade | undefined,
    bestBetRank: number | null | undefined,
  ): string {
    const highlightClass = confidence === 'high' ? ' highlight-high' : confidence === 'medium' ? ' highlight-medium' : '';
    const badge = bestBetRank != null ? `<div class="best-bet-badge">★ Best Bet #${bestBetRank} that week</div>` : '';
    return `<div class="selection-block${highlightClass}">
      <div class="selection-header"><span class="selection-label">${label} (${confidence})${pickLabel ? ` — ${esc(pickLabel)}` : ''}</span><span class="grade-text" style="color:${gradeColor(grade)}">${grade ? grade.toUpperCase() : '—'}</span></div>
      <div class="selection-numbers">${numberCell('Model', model)}${numberCell('Market', market)}${numberCell('Actual', actual)}</div>
      ${badge}
    </div>`;
  }

  function moneylineRow(game: any, pick: any, level: 'high' | 'medium', grade: Grade | undefined): string {
    const team = pick.mlPick === 'home' ? game.homeTeam?.school : game.awayTeam?.school;
    const edgePct = Math.abs(pick.mlEdge) * 100;
    const highlightClass = level === 'high' ? ' highlight-high' : ' highlight-medium';
    const badge = pick.mlBestBetRank != null ? `<div class="best-bet-badge">★ Best Bet #${pick.mlBestBetRank} that week</div>` : '';
    return `<div class="selection-block${highlightClass}">
      <div class="selection-header"><span class="selection-label">ML (${level}) — ${esc(team ?? pick.mlPick?.toUpperCase())}</span><span class="grade-text" style="color:${gradeColor(grade)}">${grade ? grade.toUpperCase() : '—'}</span></div>
      <div class="mc-expected">${edgePct.toFixed(1)}% win-prob edge</div>
      ${badge}
    </div>`;
  }

  function monteCarloRow(game: any, pick: any): string {
    if (!pick || pick.mcMedianHomeScore == null || pick.mcHomeWinProb == null) return '';
    const predictedHomeWin = pick.mcHomeWinProb > 0.5;
    const actualHomeWin = game.homePoints != null && game.awayPoints != null ? game.homePoints > game.awayPoints : undefined;
    const grade: Grade | undefined = actualHomeWin == null ? undefined : predictedHomeWin === actualHomeWin ? 'win' : 'loss';
    return `<div class="selection-block">
      <div class="selection-header"><span class="selection-label">Monte Carlo</span><span class="grade-text" style="color:${gradeColor(grade)}">${grade ? grade.toUpperCase() : '—'}</span></div>
      <div class="mc-expected">Expected: ${esc(game.awayTeam?.school ?? 'Away')} ${pick.mcMedianAwayScore} – ${esc(game.homeTeam?.school ?? 'Home')} ${pick.mcMedianHomeScore}</div>
    </div>`;
  }

  function statCell(value: string | number | undefined | null, ytd: string | number | undefined): string {
    return `<div class="stat-cell"><span class="stat-cell-value">${value ?? '—'}</span><span class="stat-cell-divider"></span><span class="stat-cell-ytd">${ytd ?? '—'}</span></div>`;
  }

  function boxScoreRow(
    label: string,
    result: 'W' | 'L' | undefined,
    record: { wins: number; losses: number } | undefined,
    stats: any,
    ytd: BoxScoreAgg,
  ): string {
    return `<div class="bs-row">
      <span class="bs-row-label">${esc(label)}</span>
      ${statCell(result, record ? `${record.wins}-${record.losses}` : undefined)}
      ${statCell(stats?.rushingYards, ytd.rushingYards)}
      ${statCell(stats?.passingYards, ytd.passingYards)}
      ${statCell(stats?.rushingAttempts, ytd.rushingAttempts)}
      ${statCell(stats?.passingAttempts, ytd.passingAttempts)}
      ${statCell(stats?.rushingTDs, ytd.rushingTDs)}
      ${statCell(stats?.passingTDs, ytd.passingTDs)}
      ${statCell(stats?.fieldGoals, ytd.fieldGoals)}
      ${statCell(stats?.drives, ytd.drives)}
      ${statCell(stats?.numberOfPlays, ytd.numberOfPlays)}
      ${statCell(stats?.possessionTime, ytd.possessionTime)}
      ${statCell(stats?.firstDowns, ytd.firstDowns)}
      ${statCell(stats?.thirdDownConv, ytd.thirdDownConv)}
      ${statCell(stats?.penalties, ytd.penalties)}
      ${statCell(stats?.turnovers, ytd.turnovers)}
    </div>`;
  }

  function renderPostGameCard(game: any): string {
    const pick = game.ensemblePicks?.[0];
    const odds = game.odds?.[0];
    const homeStats = (game.teamStats ?? []).find((s: any) => s.team?.id === game.homeTeam?.id);
    const awayStats = (game.teamStats ?? []).find((s: any) => s.team?.id === game.awayTeam?.id);
    const homeYtd = aggregateBoxScore(game.homeTeam?.gameStats ?? []);
    const awayYtd = aggregateBoxScore(game.awayTeam?.gameStats ?? []);

    const showAts = pick?.atsConfidence === 'high' || pick?.atsConfidence === 'medium';
    const showTotal = pick?.totalConfidence === 'high' || pick?.totalConfidence === 'medium';
    const mlLevel = mlConfidenceLevel(pick?.mlEdge);
    const showMl = pick?.mlPick != null && mlLevel != null;
    if (!showAts && !showTotal && !showMl) return '';

    const hasScore = game.homePoints != null && game.awayPoints != null;
    const actualSpread = hasScore ? game.awayPoints - game.homePoints : undefined;
    const actualTotal = hasScore ? game.homePoints + game.awayPoints : undefined;
    const modelSpread = pick?.adjustedPredictedMargin != null ? -pick.adjustedPredictedMargin : undefined;

    const atsTeamPicked = pick?.atsPick === 'home' ? game.homeTeam?.school : pick?.atsPick === 'away' ? game.awayTeam?.school : undefined;
    const totalPickLabel = pick?.totalPick ? pick.totalPick.toUpperCase() : undefined;

    const atsGrade = showAts ? gradeAts(pick.atsPick, game.homePoints, game.awayPoints, odds?.homeSpread) : undefined;
    const totalGrade = showTotal ? gradeTotal(pick.totalPick, game.homePoints, game.awayPoints, odds?.overUnder) : undefined;
    const mlGrade = showMl ? gradeMoneyline(pick.mlPick, game.homePoints, game.awayPoints) : undefined;

    const awayResult: 'W' | 'L' | undefined = hasScore ? (game.awayPoints > game.homePoints ? 'W' : game.awayPoints < game.homePoints ? 'L' : undefined) : undefined;
    const homeResult: 'W' | 'L' | undefined = hasScore ? (game.homePoints > game.awayPoints ? 'W' : game.homePoints < game.awayPoints ? 'L' : undefined) : undefined;

    return `<div class="pg-card">
      <div class="pg-kickoff">${formatKickoff(game.startDate)}</div>
      <div class="pg-matchup">${esc(game.awayTeam?.school ?? 'Away')} ${game.awayPoints ?? '—'} @ ${esc(game.homeTeam?.school ?? 'Home')} ${game.homePoints ?? '—'}</div>
      ${showAts ? selectionRow('ATS', pick.atsConfidence, atsTeamPicked, formatSpread(modelSpread), formatSpread(odds?.homeSpread), formatSpread(actualSpread), atsGrade, pick.atsBestBetRank) : ''}
      ${showTotal ? selectionRow('Total', pick.totalConfidence, totalPickLabel, formatTotal(pick?.predictedTotal), formatTotal(odds?.overUnder), formatTotal(actualTotal), totalGrade, pick.totalBestBetRank) : ''}
      ${showMl ? moneylineRow(game, pick, mlLevel!, mlGrade) : ''}
      ${monteCarloRow(game, pick)}
      <div class="bs-legend">Game · Season-to-date</div>
      <div class="bs-scroll"><div class="bs-table">
        <div class="bs-row bs-header"><span class="bs-row-label"></span><span class="bs-header-cell">W-L</span><span class="bs-header-cell">Rush</span><span class="bs-header-cell">Pass</span><span class="bs-header-cell">Rush Plays</span><span class="bs-header-cell">Pass Plays</span><span class="bs-header-cell">Rush TD</span><span class="bs-header-cell">Pass TD</span><span class="bs-header-cell">FG</span><span class="bs-header-cell">Drives</span><span class="bs-header-cell">Plays</span><span class="bs-header-cell">Poss</span><span class="bs-header-cell">1st Dn</span><span class="bs-header-cell">3rd Dn</span><span class="bs-header-cell">Pen</span><span class="bs-header-cell">TO</span></div>
        ${boxScoreRow(game.awayTeam?.school ?? 'Away', awayResult, teamRecords.get(game.awayTeam?.id), awayStats, awayYtd)}
        ${boxScoreRow(game.homeTeam?.school ?? 'Home', homeResult, teamRecords.get(game.homeTeam?.id), homeStats, homeYtd)}
      </div></div>
    </div>`;
  }

  function renderWeek(week: number): string {
    const visibleGames = allGames.filter((g) => g.week === week);
    const cumulativeGames = allGames.filter((g) => g.week <= week);
    const weekTallies = computeTallies(visibleGames);
    const cumulativeTallies = computeTallies(cumulativeGames);
    const banner = renderSummaryRow(`Week ${week}`, weekTallies, false) + renderSummaryRow(`Cumulative thru Wk ${week}`, cumulativeTallies, true);
    const cards = visibleGames.map(renderPostGameCard).join('');
    return `<div class="week-panel pg-week-panel" data-week="${week}" style="display:none">${banner}<div class="pg-list">${cards}</div></div>`;
  }

  const weekTabs = weeks
    .map((w, i) => `<button class="week-tab pg-week-tab${i === weeks.length - 1 ? ' active' : ''}" data-week="${w}">Week ${w}</button>`)
    .join('');
  const weekPanels = weeks.map(renderWeek).join('');

  return `<div class="week-tabs">${weekTabs}</div>${weekPanels}`;
}

// ================= assemble =================
export async function buildDashboard() {
  const [gamesHtml, bestBetsHtml, postGameHtml] = await Promise.all([
    buildGamesSection(),
    buildBestBetsSection(),
    buildPostGameSection(),
  ]);

  const generatedAt = new Date().toLocaleString('en-US', { timeZone: ET_ZONE, dateStyle: 'medium', timeStyle: 'short' }) + ' ET';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>CFB Predictor — Dashboard Snapshot</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #f6f8fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  header { background: #0b1d3a; color: #fff; padding: 14px 18px; }
  header h1 { margin: 0; font-size: 18px; }
  header .snapshot-note { font-size: 12px; color: #a9b6cc; margin-top: 4px; }
  .top-tabs { display: flex; gap: 6px; padding: 10px 14px; background: #0b1d3a; border-top: 1px solid #1a2e4a; }
  .top-tab { border: none; border-radius: 8px; padding: 8px 16px; font-size: 13px; font-weight: 800; background: #1a2e4a; color: #cfd9ea; cursor: pointer; }
  .top-tab.active { background: #fff; color: #0b1d3a; }
  .top-panel { display: none; }
  .week-tabs { display: flex; gap: 6px; flex-wrap: wrap; padding: 10px 14px; background: #0b1d3a; }
  .week-tab { border: none; border-radius: 999px; padding: 6px 14px; font-size: 12px; font-weight: 700; background: #1a2e4a; color: #cfd9ea; cursor: pointer; }
  .week-tab.active { background: #fff; color: #0b1d3a; }
  .board { display: flex; gap: 8px; overflow-x: auto; padding: 12px 6px; align-items: flex-start; }
  .column { width: 260px; flex: 0 0 auto; margin: 0 4px; }
  .date-header { display: flex; align-items: center; gap: 6px; background: #0b1d3a; color: #fff; border-radius: 8px; padding: 8px 10px; margin: 0 6px 4px; font-weight: 700; font-size: 13px; }
  .date-dot { width: 7px; height: 7px; border-radius: 4px; background: #58a6ff; display: inline-block; }
  .card { background: #fff; border-radius: 10px; padding: 10px; margin: 5px 6px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .header-row { display: flex; align-items: center; margin-bottom: 2px; }
  .kickoff { font-size: 11px; font-weight: 700; color: #57606a; }
  .tag-row { display: flex; gap: 4px; margin-left: 6px; }
  .tag { font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 3px; }
  .tag-dome { color: #0969da; background: #ddf4ff; }
  .tag-wind { color: #9a6700; background: #fff8c5; }
  .col-headers { display: flex; margin-left: auto; gap: 10px; font-size: 9px; font-weight: 700; color: #8b949e; }
  .col-headers span { width: 36px; text-align: right; }
  .team-row { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
  .logo { width: 16px; height: 16px; object-fit: contain; }
  .logo-fallback { border-radius: 8px; background: #d0d7de; }
  .ou-spacer { width: 16px; height: 16px; display: inline-block; }
  .rank { font-size: 10px; font-weight: 800; color: #9a6700; }
  .team-name { font-size: 13px; font-weight: 700; color: #0b1d3a; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .num-cols { display: flex; gap: 10px; }
  .num { font-size: 12px; font-weight: 600; color: #57606a; width: 36px; text-align: right; display: inline-block; }
  .num-model { color: #0b1d3a; }
  .picks-row { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
  .chip { border: 1px solid; border-radius: 6px; padding: 2px 5px; display: inline-flex; flex-direction: column; }
  .chip-conf { font-size: 7px; font-weight: 800; }
  .chip-text { font-size: 10px; font-weight: 700; color: #0b1d3a; }
  .no-pick { font-size: 11px; color: #8b949e; font-style: italic; margin-top: 6px; }
  .expand-hint { font-size: 10px; font-weight: 700; color: #0969da; margin-top: 6px; }

  .card-details { margin: 5px 6px; }
  .card-details .card { margin: 0; display: block; list-style: none; cursor: pointer; }
  .card-details .card::-webkit-details-marker { display: none; }
  .card-details .card::marker { content: ''; }
  .card-details[open] .card { border-bottom-left-radius: 0; border-bottom-right-radius: 0; box-shadow: none; }
  .detail-panel { background: #fff; border-radius: 0 0 10px 10px; padding: 12px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); display: flex; flex-direction: column; gap: 10px; border-top: 1px solid #eaeef2; }
  .d-venue { font-size: 12px; color: #57606a; }
  .d-section { display: flex; flex-direction: column; gap: 2px; }
  .d-section-title { font-size: 13px; font-weight: 700; color: #0b1d3a; margin-bottom: 2px; }
  .d-row { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; border-bottom: 1px solid #eaeef2; }
  .d-row-label { font-size: 12px; color: #57606a; flex-shrink: 1; }
  .d-row-value { font-size: 12px; font-weight: 600; color: #0b1d3a; text-align: right; }
  .d-dim { font-size: 12px; color: #8b949e; font-style: italic; }
  .d-team-block { margin-top: 4px; }
  .d-team-title { font-size: 12px; font-weight: 700; color: #57606a; margin-bottom: 2px; }
  .d-notable { margin-top: 6px; margin-bottom: 4px; display: flex; flex-direction: column; gap: 2px; }
  .d-notable-title { font-size: 11px; font-weight: 700; color: #0b1d3a; }
  .d-notable-item { font-size: 11px; color: #57606a; }
  .d-decay-current { color: #0b1d3a; font-weight: 700; }
  .d-arrow-in { color: #1a7f37; font-weight: 700; }
  .d-arrow-out { color: #cf222e; font-weight: 700; }

  .empty { padding: 24px; text-align: center; color: #57606a; font-size: 13px; }

  .bb-card { background: #fff; border-radius: 12px; padding: 14px; margin: 6px 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.08); }
  .bb-header { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
  .bb-rank { font-size: 13px; font-weight: 800; color: #0b1d3a; }
  .bb-market { font-size: 10px; font-weight: 700; color: #0969da; background: #ddf4ff; padding: 2px 6px; border-radius: 4px; }
  .bb-kickoff { font-size: 12px; color: #57606a; margin-left: auto; }
  .bb-pick { font-size: 17px; font-weight: 700; color: #0b1d3a; }
  .bb-confidence { font-size: 12px; font-weight: 700; }
  .bb-reason { font-size: 12px; color: #57606a; margin-top: 4px; line-height: 17px; }

  .season-banner { display: flex; flex-wrap: wrap; align-items: baseline; row-gap: 4px; column-gap: 18px; background: #fff8ec; border-bottom: 1px solid #d0d7de; padding: 8px 14px; }
  .season-banner.cumulative { background: #eef2f7; }
  .season-row-label { font-size: 11px; font-weight: 800; color: #0b1d3a; text-transform: uppercase; margin-right: 2px; }
  .season-chip { display: flex; align-items: baseline; gap: 5px; }
  .season-chip-label { font-size: 11px; font-weight: 600; color: #57606a; }
  .season-chip-value { font-size: 12px; font-weight: 800; color: #9a6700; }

  .pg-list { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  .pg-card { background: #fff; border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .pg-kickoff { font-size: 11px; font-weight: 700; color: #57606a; }
  .pg-matchup { font-size: 15px; font-weight: 700; color: #0b1d3a; }
  .selection-block { border-top: 1px solid #d0d7de; padding-top: 6px; display: flex; flex-direction: column; gap: 4px; }
  .selection-block.highlight-high { background: #dafbe1; border-top: none; border-left: 4px solid #1a7f37; padding-left: 8px; padding-top: 6px; padding-bottom: 6px; border-radius: 6px; }
  .selection-block.highlight-medium { background: #ffe9d6; border-top: none; border-left: 4px solid #bf5b04; padding-left: 8px; padding-top: 6px; padding-bottom: 6px; border-radius: 6px; }
  .selection-header { display: flex; justify-content: space-between; align-items: center; }
  .selection-label { font-size: 12px; font-weight: 700; color: #57606a; }
  .grade-text { font-size: 12px; font-weight: 800; }
  .selection-numbers { display: flex; gap: 16px; }
  .number-cell { display: flex; flex-direction: column; }
  .number-cell-label { font-size: 10px; color: #8b949e; }
  .number-cell-value { font-size: 13px; font-weight: 600; color: #0b1d3a; }
  .mc-expected { font-size: 13px; font-weight: 600; color: #0b1d3a; }
  .best-bet-badge { font-size: 11px; font-weight: 700; color: #9a6700; margin-top: 2px; }
  .bs-legend { font-size: 10px; color: #8b949e; margin-top: 6px; margin-bottom: 2px; }
  .bs-scroll { border-top: 1px solid #d0d7de; padding-top: 4px; overflow-x: auto; }
  .bs-table { display: flex; flex-direction: column; gap: 4px; min-width: max-content; }
  .bs-row { display: flex; align-items: center; gap: 8px; }
  .bs-row-label { font-size: 12px; font-weight: 600; color: #0b1d3a; width: 90px; flex-shrink: 0; }
  .bs-header-cell { font-size: 10px; font-weight: 700; color: #8b949e; width: 68px; text-align: center; flex-shrink: 0; }
  .stat-cell { width: 68px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; gap: 4px; }
  .stat-cell-value { font-size: 12px; font-weight: 600; color: #57606a; }
  .stat-cell-divider { width: 1px; height: 12px; background: #d0d7de; }
  .stat-cell-ytd { font-size: 11px; font-weight: 500; color: #8b949e; }
</style>
</head>
<body>
<header>
  <h1>CFB Predictor</h1>
  <div class="snapshot-note">Static snapshot generated ${generatedAt} — not live. Regenerated daily by the ETL job (scripts/buildDashboard.ts); the running app at localhost:8098 always reflects current data.</div>
</header>
<div class="top-tabs">
  <button class="top-tab active" data-panel="games">CFB Games</button>
  <button class="top-tab" data-panel="bestbets">Best Bets</button>
  <button class="top-tab" data-panel="postgame">Post-Game Analysis</button>
</div>
<div class="top-panel" data-panel="games" style="display:block">${gamesHtml}</div>
<div class="top-panel" data-panel="bestbets">${bestBetsHtml}</div>
<div class="top-panel" data-panel="postgame">${postGameHtml}</div>
<script>
  var topTabs = document.querySelectorAll('.top-tab');
  var topPanels = document.querySelectorAll('.top-panel');
  topTabs.forEach(function (t) {
    t.addEventListener('click', function () {
      topTabs.forEach(function (x) { x.classList.toggle('active', x === t); });
      topPanels.forEach(function (p) { p.style.display = p.dataset.panel === t.dataset.panel ? 'block' : 'none'; });
    });
  });

  function wireWeekTabs(tabClass, panelClass) {
    var tabs = document.querySelectorAll('.' + tabClass);
    var panels = document.querySelectorAll('.' + panelClass);
    function show(week) {
      tabs.forEach(function (t) { t.classList.toggle('active', t.dataset.week === week); });
      panels.forEach(function (p) { p.style.display = p.dataset.week === week ? '' : 'none'; });
    }
    tabs.forEach(function (t) { t.addEventListener('click', function () { show(t.dataset.week); }); });
    var activeTab = document.querySelector('.' + tabClass + '.active');
    if (activeTab) show(activeTab.dataset.week);
  }
  wireWeekTabs('games-week-tab', 'games-week-panel');
  wireWeekTabs('bb-week-tab', 'bb-week-panel');
  wireWeekTabs('pg-week-tab', 'pg-week-panel');
</script>
</body>
</html>`;

  fs.writeFileSync(OUT_PATH, html, 'utf-8');
  console.log(`[dashboard] wrote ${OUT_PATH}`);
}

if (require.main === module) {
  buildDashboard().catch((err) => {
    console.error('[dashboard] FAILED —', err);
    process.exitCode = 1;
  });
}
