import { loadConfig } from './config.js';
import { createDatabase } from './db.js';
import { createApp } from './app.js';

const config = loadConfig();
if (config.jwtSecret === 'development-only-change-me' && process.env.NODE_ENV === 'production') {
  throw new Error('生产环境必须设置 JWT_SECRET');
}
const db = createDatabase(config.databasePath);
const app = createApp(config, db);
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`PhotoBackup server listening on :${config.port}`);
});

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
