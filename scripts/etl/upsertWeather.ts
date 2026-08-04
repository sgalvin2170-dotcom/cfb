// Weather ETL step: Open-Meteo -> InstantDB `weather`. Needs games + venues
// already upserted (for kickoff time and lat/lng/dome). Only fetches for
// outdoor games within Open-Meteo's ~15-day forecast window — most runs
// will skip most/all games here, which is expected (see openMeteo.ts).
import { lookup } from '@instantdb/admin';

import { db, transactInChunks } from './instantAdmin';
import { recordRun } from './upsertCore';
import { env } from './env';
import { fetchWeatherAtKickoff, withinForecastWindow } from './sources/openMeteo';

async function upsertWeather(week?: number) {
  const { games } = await db.query({
    games: {
      $: { where: week != null ? { season: env.season, week } : { season: env.season } },
      venue: {},
    },
  });

  const now = new Date().toISOString();
  const eligible = (games as any[]).filter(
    (g) => g.venue && !g.venue.dome && g.venue.lat != null && g.venue.lng != null && withinForecastWindow(new Date(g.startDate)),
  );

  let fetched = 0;
  const txs: any[] = [];
  for (const game of eligible) {
    const weather = await fetchWeatherAtKickoff(game.venue.lat, game.venue.lng, new Date(game.startDate));
    if (!weather) continue;
    fetched++;
    txs.push(
      db.tx.weather.lookup('weatherKey', String(game.cfbdGameId))
        .update({
          forecastAt: now,
          tempF: weather.tempF,
          windMph: weather.windMph,
          windDir: weather.windDir,
          precipProb: weather.precipProb,
          isDome: false,
        })
        .link({ game: lookup('cfbdGameId', game.cfbdGameId) }),
    );
  }

  await transactInChunks(txs);
  console.log(
    `[weather] ${fetched}/${eligible.length} eligible game(s) forecast (${(games as any[]).length - eligible.length} skipped: dome or outside the ~15-day forecast window)`,
  );
  return fetched;
}

export async function runWeatherIngestion(week?: number) {
  return recordRun('open-meteo:weather', () => upsertWeather(week));
}
