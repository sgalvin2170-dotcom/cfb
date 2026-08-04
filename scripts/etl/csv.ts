import { stringify } from 'csv-stringify/sync';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { db } from './instantAdmin';
import { env } from './env';

const UTF8_BOM = '﻿';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function exportTodayCsv(date: Date = new Date()) {
  const { games } = await db.query({
    games: {
      $: { where: { season: env.season }, order: { startDate: 'asc' } },
      homeTeam: { talent: {} },
      awayTeam: { talent: {} },
      venue: {},
      ensemblePicks: {},
      weatherForecasts: {},
    },
  });

  const rows = (games ?? []).map((g: any) => {
    const pick = g.ensemblePicks?.[0];
    const weather = g.weatherForecasts?.[0];
    return {
      kickoff_utc: g.startDate,
      week: g.week,
      away_team: g.awayTeam?.school ?? '',
      home_team: g.homeTeam?.school ?? '',
      venue: g.venue?.name ?? '',
      dome: g.venue?.dome ? 'yes' : 'no',
      capacity: g.venue?.capacity ?? '',
      wind_mph: weather?.windMph ?? '',
      wind_dir: weather?.windDir ?? '',
      temp_f: weather?.tempF ?? '',
      precip_pct: weather?.precipProb ?? '',
      away_talent: g.awayTeam?.talent?.[0]?.talentScore ?? '',
      home_talent: g.homeTeam?.talent?.[0]?.talentScore ?? '',
      market_spread_home: pick?.marketHomeSpread ?? '',
      market_total: pick?.marketTotal ?? '',
      model_margin_adjusted: pick?.adjustedPredictedMargin ?? '',
      model_total: pick?.predictedTotal ?? '',
      ats_pick: pick?.atsPick ?? '',
      ats_confidence: pick?.atsConfidence ?? '',
      total_pick: pick?.totalPick ?? '',
      total_confidence: pick?.totalConfidence ?? '',
      ml_pick: pick?.mlPick ?? '',
      ml_edge: pick?.mlEdge ?? '',
      adjustment_notes: pick?.adjustmentNotes ?? '',
    };
  });

  const csv = stringify(rows, {
    header: true,
    columns: [
      'kickoff_utc',
      'week',
      'away_team',
      'home_team',
      'venue',
      'dome',
      'capacity',
      'wind_mph',
      'wind_dir',
      'temp_f',
      'precip_pct',
      'away_talent',
      'home_talent',
      'market_spread_home',
      'market_total',
      'model_margin_adjusted',
      'model_total',
      'ats_pick',
      'ats_confidence',
      'total_pick',
      'total_confidence',
      'ml_pick',
      'ml_edge',
      'adjustment_notes',
    ],
  });

  const dateStr = isoDate(date);
  const outDir = path.join(process.cwd(), 'exports', dateStr);
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `cfb_today_${dateStr}.csv`);
  writeFileSync(outPath, UTF8_BOM + csv, 'utf8');

  console.log(`Wrote ${rows.length} rows to ${outPath}`);
  return outPath;
}
