// Loads .env for local runs, overriding any pre-existing shell/system env
// vars of the same name (this machine has a stale global INSTANT_APP_ID from
// an unrelated project, which would otherwise silently shadow ours). In
// GitHub Actions there's no such shadowing risk since secrets are injected
// fresh per-run, so `override: true` is a no-op there.
import { config } from 'dotenv';
config({ override: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export const env = {
  instantAppId: required('INSTANT_APP_ID'),
  instantAdminToken: required('INSTANT_APP_ADMIN_TOKEN'),
  cfbdApiKey: required('CFBD_API_KEY'),
  season: Number(process.env.CFB_SEASON ?? new Date().getFullYear()),
};
