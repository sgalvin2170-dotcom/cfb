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
      homeTeam: {},
      awayTeam: {},
      venue: {},
      ensemblePicks: {},
    },
  });

  const rows = (games ?? []).map((g: any) => {
    const pick = g.ensemblePicks?.[0];
    return {
      kickoff_utc: g.startDate,
      week: g.week,
      away_team: g.awayTeam?.school ?? '',
      home_team: g.homeTeam?.school ?? '',
      venue: g.venue?.name ?? '',
      dome: g.venue?.dome ? 'yes' : 'no',
      capacity: g.venue?.capacity ?? '',
      market_spread_home: pick?.marketHomeSpread ?? '',
      market_total: pick?.marketTotal ?? '',
      model_margin_adjusted: pick?.adjustedPredictedMargin ?? '',
      model_total: pick?.predictedTotal ?? '',
      ats_pick: pick?.atsPick ?? '',
      ats_confidence: pick?.atsConfidence ?? '',
      total_pick: pick?.totalPick ?? '',
      total_confidence: pick?.totalConfidence ?? '',
      ml_pick: pick?.mlPick ?? '',
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
      'market_spread_home',
      'market_total',
      'model_margin_adjusted',
      'model_total',
      'ats_pick',
      'ats_confidence',
      'total_pick',
      'total_confidence',
      'ml_pick',
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
