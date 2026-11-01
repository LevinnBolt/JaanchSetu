// Local PostgreSQL without Docker (uses the embedded-postgres npm package).
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.pgdata');
const fresh = !fs.existsSync(path.join(dir, 'PG_VERSION'));
const pg = new EmbeddedPostgres({
  databaseDir: dir, user: 'sakshi', password: 'sakshi', port: 54329, persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});
if (fresh) await pg.initialise();
await pg.start();
try { await pg.createDatabase('sakshi'); } catch { /* already exists */ }
fs.writeFileSync(path.join(dir, '.ready'), String(Date.now()));
console.log('PostgreSQL ready on port 54329' + (fresh ? ' (new database)' : ''));
const stop = async () => { try { await pg.stop(); } catch {} process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
