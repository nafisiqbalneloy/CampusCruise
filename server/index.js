import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createApp, loadSecret, ensureAdmin } from './app.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || join(root, 'data');
const port = Number(process.env.PORT || 3000);

const { handler, db } = createApp({
  dbFile: join(dataDir, 'campuscruise.db'),
  publicDir: join(root, 'public'),
  secret: loadSecret(dataDir),
  allowedDomain: process.env.ALLOWED_EMAIL_DOMAIN || 'uiu.ac.bd',
  secureCookie: process.env.NODE_ENV === 'production',
});

const adminEmail = process.env.ADMIN_EMAIL || 'admin@uiu.ac.bd';
const generated = ensureAdmin(db, { email: adminEmail, password: process.env.ADMIN_PASSWORD });
if (generated) console.log(`\n  First run: admin login  ${adminEmail}  /  ${generated}\n  (set ADMIN_EMAIL and ADMIN_PASSWORD to choose your own)\n`);

createServer(handler).listen(port, () => console.log(`Campus-Cruise running on http://localhost:${port}`));
