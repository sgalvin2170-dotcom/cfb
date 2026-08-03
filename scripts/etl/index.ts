// Daily ETL entrypoint. Run with: npm run etl -- [week]
// Vertical slice only for now (CFBD + ESPN logos) — see the plan doc's
// phased build order for what sources get added next (ESPN FPI, Sagarin,
// FEI, TeamRankings, ThePredictionTracker, weather, injuries, ensemble math).
import { runCfbdVerticalSlice } from './upsertCore';
import { exportTodayCsv } from './csv';

async function main() {
  const weekArg = process.argv[2];
  const week = weekArg ? Number(weekArg) : undefined;

  console.log(`Starting CFBD vertical-slice ETL run${week ? ` for week ${week}` : ' (all weeks)'}...`);
  const result = await runCfbdVerticalSlice(week);
  console.log('ETL summary:', result);

  await exportTodayCsv();
}

main().catch((err) => {
  console.error('ETL run failed:', err);
  process.exitCode = 1;
});
