// Fills a fresh database with demo students, a driver and a few rides for local development.
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { hashPassword } from './auth.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || join(root, 'data');
const db = openDb(join(dataDir, 'campuscruise.db'));

if (db.prepare('SELECT COUNT(*) n FROM rides').get().n) { console.log('Database already has rides; skipping seed.'); process.exit(0); }

const pw = hashPassword('password123');
const addUser = (name, email, sid) => Number(db.prepare("INSERT INTO users (name,email,pass_hash,student_id,phone,status) VALUES (?,?,?,?,'01712345678','approved')").run(name, email, pw, sid).lastInsertRowid);
const arif = addUser('Arif Ahmed', 'arif@bscse.uiu.ac.bd', '0112330101');
const sabrina = addUser('Sabrina Khan', 'sabrina@bscse.uiu.ac.bd', '0112330102');
const rahat = addUser('Rahat Ahmed', 'rahat@bscse.uiu.ac.bd', '0112330103');
db.prepare("INSERT INTO vehicles (user_id,model,plate,license_no,status) VALUES (?,?,?,?, 'approved')").run(rahat, 'Yamaha R15', 'DHAKA-METRO-LA-8842', 'DL-100200');
db.prepare("INSERT INTO vehicles (user_id,model,plate,license_no,status) VALUES (?,?,?,?, 'approved')").run(sabrina, 'Honda CB Hornet', 'DHAKA-METRO-LA-5521', 'DL-300400');
const at = h => new Date(Date.now() + h * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
const ride = (d, o, t, h, seats, fare, note = '') => db.prepare('INSERT INTO rides (driver_id,origin,destination,depart_at,seats,fare,note) VALUES (?,?,?,?,?,?,?)').run(d, o, t, at(h), seats, fare, note);
ride(rahat, 'Aftabnagar', 'UIU Campus', 2, 2, 60, 'Meeting at the main gate, helmet provided');
ride(rahat, 'Badda', 'UIU Campus', 4, 1, 50);
ride(sabrina, 'Rampura', 'UIU Campus', 3, 2, 45, 'Leaving right after class');
ride(sabrina, 'UIU Campus', 'Gulshan 2', 6, 1, 70);
console.log('Seeded. Log in as arif@bscse.uiu.ac.bd / password123 (rider), rahat@bscse.uiu.ac.bd (driver). Admin login is printed on first server start.');
