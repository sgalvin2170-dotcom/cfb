import { init } from '@instantdb/admin';

import schema from '../../instant.schema';
import { env } from './env';

export const db = init({
  appId: env.instantAppId,
  adminToken: env.instantAdminToken,
  schema,
});

// InstantDB caps params per transaction; several sources return far more
// rows than fit in one call (e.g. CFBD's /venues returns 800+), so bulk
// writes always go through this.
const CHUNK_SIZE = 100;

export async function transactInChunks(txs: any[]) {
  for (let i = 0; i < txs.length; i += CHUNK_SIZE) {
    await db.transact(txs.slice(i, i + CHUNK_SIZE));
  }
}
