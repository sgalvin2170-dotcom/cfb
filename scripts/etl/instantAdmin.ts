import { init } from '@instantdb/admin';

import schema from '../../instant.schema';
import { env } from './env';

export const db = init({
  appId: env.instantAppId,
  adminToken: env.instantAdminToken,
  schema,
});
