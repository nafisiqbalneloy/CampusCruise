import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openDb, tx } from './db.js';
import { hashPassword, verifyPassword, makeToken, readToken, parseCookies, makeLimiter } from './auth.js';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = m => new HttpError(400, m);
const forbidden = m => new HttpError(403, m);
const notFound = (m = 'Not found') => new HttpError(404, m);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

const str = (v, name, { min = 1, max = 200 } = {}) => {
  if (typeof v !== 'string') throw bad(`${name} is required`);
  const s = v.trim();
  if (s.length < min || s.length > max) throw bad(`${name} must be ${min}-${max} characters`);
  return s;
};
const int = (v, name, min, max) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number from ${min} to ${max}`);
  return n;
};

export function createApp({ dbFile = ':memory:', publicDir, secret, allowedDomain = 'uiu.ac.bd', secureCookie = false } = {}) {
  const db = openDb(dbFile);
  const loginLimit = makeLimiter(10, 15 * 60 * 1000);
  const registerLimit = makeLimiter(10, 60 * 60 * 1000);
  const q = {
    userById: db.prepare('SELECT id,name,email,student_id,phone,role,status,created_at FROM users WHERE id=?'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email=?'),
    vehicle: db.prepare('SELECT model,plate,license_no,status FROM vehicles WHERE user_id=?'),
    rating: db.prepare('SELECT ROUND(AVG(stars),1) AS avg, COUNT(*) AS n FROM ratings WHERE to_id=?'),
    ride: db.prepare('SELECT * FROM rides WHERE id=?'),
    booking: db.prepare('SELECT * FROM bookings WHERE id=?'),
    taken: db.prepare("SELECT COALESCE(SUM(seats),0) AS n FROM bookings WHERE ride_id=? AND status='accepted'"),
  };

  const rating = id => q.rating.get(id);
  const publicUser = id => {
    const u = db.prepare('SELECT id,name FROM users WHERE id=?').get(id);
    return u ? { ...u, rating: rating(id) } : null;
  };
  const seatsLeft = ride => ride.seats - q.taken.get(ride.id).n;
  const rideView = r => ({
    ...r,
    seats_left: seatsLeft(r),
    driver: publicUser(r.driver_id),
    vehicle: db.prepare("SELECT model,plate FROM vehicles WHERE user_id=?").get(r.driver_id) || null,
  });
  const bookingView = b => {
    const ride = q.ride.get(b.ride_id);
    return { ...b, ride: rideView(ride), rider: publicUser(b.rider_id) };
  };

  function setSession(res, userId) {
    const flags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}${secureCookie ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', `cc_session=${makeToken(secret, userId)}; ${flags}`);
  }

  const needUser = ctx => { if (!ctx.user) throw new HttpError(401, 'Please log in'); return ctx.user; };
  const needApproved = ctx => {
    const u = needUser(ctx);
    if (u.status !== 'approved') throw forbidden('Your account is waiting for admin verification');
    return u;
  };
  const needAdmin = ctx => {
    const u = needUser(ctx);
    if (u.role !== 'admin') throw forbidden('Admins only');
    return u;
  };
  const needDriver = ctx => {
    const u = needApproved(ctx);
    const v = q.vehicle.get(u.id);
    if (!v || v.status !== 'approved') throw forbidden('You need an approved driver profile to do this');
    return u;
  };
  const participant = (user, ride) => {
    if (user.id === ride.driver_id) return true;
    return !!db.prepare("SELECT 1 FROM bookings WHERE ride_id=? AND rider_id=? AND status='accepted'").get(ride.id, user.id);
  };
  const bookingAccess = (user, id) => {
    const b = q.booking.get(id);
    if (!b) throw notFound('Booking not found');
    const ride = q.ride.get(b.ride_id);
    if (user.id !== b.rider_id && user.id !== ride.driver_id) throw forbidden('Not your booking');
    return { b, ride };
  };

  // ---------- routes ----------
  const routes = [];
  const route = (method, path, handler) => {
    const keys = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler });
  };

  // --- auth & profile ---
  route('POST', '/api/register', ctx => {
    if (!registerLimit(ctx.ip)) throw new HttpError(429, 'Too many sign-ups, try again later');
    const b = ctx.body;
    const email = str(b.email, 'Email', { max: 120 }).toLowerCase();
    const domain = email.split('@')[1] || '';
    if (!/^[^\s@]+@[^\s@]+$/.test(email) || !(domain === allowedDomain || domain.endsWith('.' + allowedDomain))) {
      throw bad(`Use your official UIU email (…@${allowedDomain})`);
    }
    const password = str(b.password, 'Password', { min: 8, max: 100 });
    if (q.userByEmail.get(email)) throw new HttpError(409, 'That email is already registered');
    const info = db.prepare('INSERT INTO users (name,email,pass_hash,student_id,phone) VALUES (?,?,?,?,?)').run(
      str(b.name, 'Name', { max: 80 }), email, hashPassword(password),
      str(b.student_id, 'Student ID', { min: 5, max: 20 }), String(b.phone || '').trim().slice(0, 20));
    setSession(ctx.res, Number(info.lastInsertRowid));
    return { status: 201, data: { user: q.userById.get(Number(info.lastInsertRowid)) } };
  });

  route('POST', '/api/login', ctx => {
    const email = str(ctx.body.email, 'Email').toLowerCase();
    if (!loginLimit(`${ctx.ip}|${email}`)) throw new HttpError(429, 'Too many attempts, try again in a few minutes');
    const u = q.userByEmail.get(email);
    if (!u || !verifyPassword(String(ctx.body.password || ''), u.pass_hash)) throw new HttpError(401, 'Wrong email or password');
    if (u.status === 'banned') throw forbidden('This account has been suspended');
    setSession(ctx.res, u.id);
    return { data: { user: q.userById.get(u.id) } };
  });

  route('POST', '/api/logout', ctx => {
    ctx.res.setHeader('Set-Cookie', 'cc_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return { data: { ok: true } };
  });

  route('GET', '/api/me', ctx => {
    const u = needUser(ctx);
    return { data: { user: u, vehicle: q.vehicle.get(u.id) || null, rating: rating(u.id),
      routines: db.prepare('SELECT weekday,time,place FROM routines WHERE user_id=? ORDER BY weekday,time').all(u.id) } };
  });

  route('PUT', '/api/me', ctx => {
    const u = needUser(ctx);
    db.prepare('UPDATE users SET name=?, phone=? WHERE id=?').run(
      str(ctx.body.name, 'Name', { max: 80 }), String(ctx.body.phone || '').trim().slice(0, 20), u.id);
    return { data: { user: q.userById.get(u.id) } };
  });

  route('POST', '/api/driver/apply', ctx => {
    const u = needApproved(ctx);
    const b = ctx.body;
    const v = [str(b.model, 'Bike model', { max: 60 }), str(b.plate, 'Plate number', { max: 30 }), str(b.license_no, 'Licence number', { max: 40 })];
    db.prepare(`INSERT INTO vehicles (user_id,model,plate,license_no,status) VALUES (?,?,?,?, 'pending')
      ON CONFLICT(user_id) DO UPDATE SET model=excluded.model, plate=excluded.plate, license_no=excluded.license_no, status='pending'`).run(u.id, ...v);
    return { status: 201, data: { vehicle: q.vehicle.get(u.id) } };
  });

  route('PUT', '/api/routines', ctx => {
    const u = needApproved(ctx);
    const list = Array.isArray(ctx.body.routines) ? ctx.body.routines.slice(0, 14) : [];
    tx(db, () => {
      db.prepare('DELETE FROM routines WHERE user_id=?').run(u.id);
      const ins = db.prepare('INSERT INTO routines (user_id,weekday,time,place) VALUES (?,?,?,?)');
      for (const r of list) {
        const time = str(r.time, 'Time', { max: 5 });
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw bad('Time must look like 09:30');
        ins.run(u.id, int(r.weekday, 'Weekday', 0, 6), time, str(r.place, 'Place', { max: 80 }));
      }
    });
    return { data: { ok: true } };
  });

  // --- rides ---
  route('GET', '/api/rides', ctx => {
    needApproved(ctx);
    const { from = '', to = '', date = '', max_fare = '' } = ctx.query;
    let sql = "SELECT * FROM rides WHERE status='open' AND depart_at >= datetime('now','-30 minutes')";
    const args = [];
    if (from) { sql += ' AND origin LIKE ?'; args.push(`%${from}%`); }
    if (to) { sql += ' AND destination LIKE ?'; args.push(`%${to}%`); }
    if (date) { sql += ' AND date(depart_at)=?'; args.push(date); }
    if (max_fare) { sql += ' AND fare<=?'; args.push(int(max_fare, 'Max fare', 0, 100000)); }
    sql += ' ORDER BY depart_at LIMIT 100';
    const rides = db.prepare(sql).all(...args).map(rideView).filter(r => r.seats_left > 0);
    return { data: { rides } };
  });

  // Smart matching: rides near the user's saved class routine (same weekday, ±60 min, destination/origin matches the place).
  route('GET', '/api/rides/recommended', ctx => {
    const u = needApproved(ctx);
    const routines = db.prepare('SELECT weekday,time,place FROM routines WHERE user_id=?').all(u.id);
    if (!routines.length) return { data: { rides: [], hint: 'Add your class routine in Profile to get matches' } };
    const rides = db.prepare("SELECT * FROM rides WHERE status='open' AND driver_id<>? AND depart_at >= datetime('now') ORDER BY depart_at LIMIT 200").all(u.id)
      .map(rideView).filter(r => r.seats_left > 0);
    const minutes = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const scored = [];
    for (const r of rides) {
      const d = new Date(r.depart_at.replace(' ', 'T') + 'Z');
      let best = 0;
      for (const rt of routines) {
        const place = rt.place.toLowerCase();
        if (!r.destination.toLowerCase().includes(place) && !r.origin.toLowerCase().includes(place)) continue;
        let s = 2;
        if (d.getUTCDay() === rt.weekday) s += 1;
        const diff = Math.abs(minutes(`${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`) - minutes(rt.time));
        if (diff <= 60) s += 2 - diff / 60;
        if (s > best) best = s;
      }
      if (best >= 3) scored.push({ ...r, match: Math.round(best * 20) });
    }
    scored.sort((a, b) => b.match - a.match);
    return { data: { rides: scored.slice(0, 10) } };
  });

  route('POST', '/api/rides', ctx => {
    const u = needDriver(ctx);
    const b = ctx.body;
    const when = new Date(String(b.depart_at));
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() - 5 * 60000) throw bad('Pick a departure time in the future');
    const info = db.prepare('INSERT INTO rides (driver_id,origin,destination,depart_at,seats,fare,note) VALUES (?,?,?,?,?,?,?)').run(
      u.id, str(b.origin, 'Pickup', { max: 100 }), str(b.destination, 'Destination', { max: 100 }),
      when.toISOString().slice(0, 19).replace('T', ' '),
      int(b.seats, 'Seats', 1, 3), int(b.fare, 'Fare', 0, 5000), String(b.note || '').trim().slice(0, 200));
    return { status: 201, data: { ride: rideView(q.ride.get(Number(info.lastInsertRowid))) } };
  });

  route('GET', '/api/rides/:id', ctx => {
    const u = needApproved(ctx);
    const r = q.ride.get(Number(ctx.params.id));
    if (!r) throw notFound('Ride not found');
    const out = { ride: rideView(r) };
    if (u.id === r.driver_id) {
      out.bookings = db.prepare('SELECT * FROM bookings WHERE ride_id=? ORDER BY id').all(r.id).map(bookingView);
    } else {
      const mine = db.prepare('SELECT * FROM bookings WHERE ride_id=? AND rider_id=?').get(r.id, u.id);
      out.booking = mine ? bookingView(mine) : null;
    }
    return { data: out };
  });

  route('PATCH', '/api/rides/:id', ctx => {
    const u = needDriver(ctx);
    const r = q.ride.get(Number(ctx.params.id));
    if (!r || r.driver_id !== u.id) throw notFound('Ride not found');
    const action = ctx.body.action;
    const next = { start: ['open', 'started'], finish: ['started', 'done'], cancel: ['open', 'cancelled'] }[action];
    if (!next) throw bad('Unknown action');
    if (r.status !== next[0]) throw bad(`Ride is ${r.status}; cannot ${action}`);
    tx(db, () => {
      db.prepare('UPDATE rides SET status=? WHERE id=?').run(next[1], r.id);
      if (action === 'cancel') db.prepare("UPDATE bookings SET status='cancelled' WHERE ride_id=? AND status IN ('pending','accepted')").run(r.id);
      if (action === 'start') db.prepare("UPDATE bookings SET status='rejected' WHERE ride_id=? AND status='pending'").run(r.id);
    });
    return { data: { ride: rideView(q.ride.get(r.id)) } };
  });

  route('POST', '/api/rides/:id/bookings', ctx => {
    const u = needApproved(ctx);
    const r = q.ride.get(Number(ctx.params.id));
    if (!r || r.status !== 'open') throw notFound('This ride is no longer open');
    if (r.driver_id === u.id) throw bad('You cannot book your own ride');
    const seats = int(ctx.body.seats ?? 1, 'Seats', 1, 3);
    if (seats > seatsLeft(r)) throw bad('Not enough seats left');
    const existing = db.prepare('SELECT id,status FROM bookings WHERE ride_id=? AND rider_id=?').get(r.id, u.id);
    if (existing && ['pending', 'accepted'].includes(existing.status)) throw new HttpError(409, 'You already requested this ride');
    let id;
    if (existing) {
      db.prepare("UPDATE bookings SET status='pending', seats=?, fare=?, pay_method=NULL, pay_status='unpaid', txn_id=NULL WHERE id=?").run(seats, r.fare * seats, existing.id);
      id = existing.id;
    } else {
      id = Number(db.prepare('INSERT INTO bookings (ride_id,rider_id,seats,fare) VALUES (?,?,?,?)').run(r.id, u.id, seats, r.fare * seats).lastInsertRowid);
    }
    return { status: 201, data: { booking: bookingView(q.booking.get(id)) } };
  });

  route('POST', '/api/rides/:id/location', ctx => {
    const u = needApproved(ctx);
    const r = q.ride.get(Number(ctx.params.id));
    if (!r || r.driver_id !== u.id) throw notFound('Ride not found');
    if (r.status !== 'started') throw bad('Start the ride before sharing your location');
    const lat = Number(ctx.body.lat), lng = Number(ctx.body.lng);
    if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) throw bad('Invalid coordinates');
    db.prepare(`INSERT INTO locations (ride_id,lat,lng,updated_at) VALUES (?,?,?,datetime('now'))
      ON CONFLICT(ride_id) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,updated_at=excluded.updated_at`).run(r.id, lat, lng);
    return { data: { ok: true } };
  });

  route('GET', '/api/rides/:id/location', ctx => {
    const u = needApproved(ctx);
    const r = q.ride.get(Number(ctx.params.id));
    if (!r || !participant(u, r)) throw notFound('Ride not found');
    return { data: { status: r.status, location: db.prepare('SELECT lat,lng,updated_at FROM locations WHERE ride_id=?').get(r.id) || null } };
  });

  route('POST', '/api/rides/:id/ratings', ctx => {
    const u = needApproved(ctx);
    const r = q.ride.get(Number(ctx.params.id));
    if (!r || r.status !== 'done') throw bad('You can rate once the ride is finished');
    if (!participant(u, r)) throw forbidden('You were not on this ride');
    const toId = int(ctx.body.to_id, 'Person', 1, 1e9);
    const toOk = toId === r.driver_id
      ? u.id !== r.driver_id
      : u.id === r.driver_id && db.prepare("SELECT 1 FROM bookings WHERE ride_id=? AND rider_id=? AND status='accepted'").get(r.id, toId);
    if (!toOk) throw bad('You cannot rate that person for this ride');
    try {
      db.prepare('INSERT INTO ratings (ride_id,from_id,to_id,stars,comment) VALUES (?,?,?,?,?)').run(
        r.id, u.id, toId, int(ctx.body.stars, 'Stars', 1, 5), String(ctx.body.comment || '').trim().slice(0, 300));
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'You already rated this person for this ride');
      throw e;
    }
    return { status: 201, data: { rating: rating(toId) } };
  });

  // --- my stuff ---
  route('GET', '/api/my/rides', ctx => {
    const u = needApproved(ctx);
    const rides = db.prepare('SELECT * FROM rides WHERE driver_id=? ORDER BY depart_at DESC LIMIT 50').all(u.id).map(r => ({
      ...rideView(r),
      bookings: db.prepare('SELECT * FROM bookings WHERE ride_id=? ORDER BY id').all(r.id).map(bookingView),
    }));
    return { data: { rides } };
  });

  route('GET', '/api/my/bookings', ctx => {
    const u = needApproved(ctx);
    const rows = db.prepare('SELECT * FROM bookings WHERE rider_id=? ORDER BY id DESC LIMIT 50').all(u.id).map(bookingView);
    const rated = db.prepare('SELECT ride_id,to_id FROM ratings WHERE from_id=?').all(u.id);
    return { data: { bookings: rows, rated } };
  });

  // --- bookings, chat, payment ---
  route('PATCH', '/api/bookings/:id', ctx => {
    const u = needApproved(ctx);
    const { b, ride } = bookingAccess(u, Number(ctx.params.id));
    const action = ctx.body.action;
    if (['accept', 'reject', 'cash_received'].includes(action) && u.id !== ride.driver_id) throw forbidden('Only the driver can do that');
    if (action === 'cancel' && u.id !== b.rider_id) throw forbidden('Only the rider can cancel');
    tx(db, () => {
      const cur = q.booking.get(b.id);
      if (action === 'accept') {
        if (cur.status !== 'pending' || ride.status !== 'open') throw bad('This request can no longer be accepted');
        if (cur.seats > seatsLeft(ride)) throw bad('Not enough seats left');
        db.prepare("UPDATE bookings SET status='accepted' WHERE id=?").run(b.id);
      } else if (action === 'reject') {
        if (cur.status !== 'pending') throw bad('Only pending requests can be rejected');
        db.prepare("UPDATE bookings SET status='rejected' WHERE id=?").run(b.id);
      } else if (action === 'cancel') {
        if (!['pending', 'accepted'].includes(cur.status) || ['started', 'done'].includes(ride.status)) throw bad('This booking cannot be cancelled now');
        db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(b.id);
      } else if (action === 'cash_received') {
        if (cur.status !== 'accepted' || cur.pay_method !== 'cash' || cur.pay_status === 'paid') throw bad('No cash payment to confirm');
        db.prepare("UPDATE bookings SET pay_status='paid' WHERE id=?").run(b.id);
      } else throw bad('Unknown action');
    });
    return { data: { booking: bookingView(q.booking.get(b.id)) } };
  });

  route('GET', '/api/bookings/:id/messages', ctx => {
    const u = needApproved(ctx);
    const { b } = bookingAccess(u, Number(ctx.params.id));
    const messages = db.prepare('SELECT m.id,m.sender_id,u.name AS sender,m.body,m.offer,m.accepted,m.created_at FROM messages m JOIN users u ON u.id=m.sender_id WHERE booking_id=? ORDER BY m.id').all(b.id);
    return { data: { messages, fare: b.fare } };
  });

  route('POST', '/api/bookings/:id/messages', ctx => {
    const u = needApproved(ctx);
    const { b } = bookingAccess(u, Number(ctx.params.id));
    if (['rejected', 'cancelled'].includes(b.status)) throw bad('This chat is closed');
    const offer = ctx.body.offer == null || ctx.body.offer === '' ? null : int(ctx.body.offer, 'Offer', 0, 5000 * 3);
    const body = offer != null && !ctx.body.body ? `Proposed fare: ৳${offer}` : str(ctx.body.body, 'Message', { max: 500 });
    const info = db.prepare('INSERT INTO messages (booking_id,sender_id,body,offer) VALUES (?,?,?,?)').run(b.id, u.id, body, offer);
    return { status: 201, data: { id: Number(info.lastInsertRowid) } };
  });

  route('POST', '/api/messages/:id/accept', ctx => {
    const u = needApproved(ctx);
    const m = db.prepare('SELECT * FROM messages WHERE id=?').get(Number(ctx.params.id));
    if (!m || m.offer == null) throw notFound('Offer not found');
    const { b } = bookingAccess(u, m.booking_id);
    if (m.sender_id === u.id) throw bad('The other person has to accept your offer');
    if (b.pay_status === 'paid') throw bad('Already paid; the fare can no longer change');
    tx(db, () => {
      db.prepare('UPDATE messages SET accepted=1 WHERE id=?').run(m.id);
      db.prepare('UPDATE bookings SET fare=? WHERE id=?').run(m.offer, b.id);
    });
    return { data: { fare: m.offer } };
  });

  // Payments are a SANDBOX: no real money moves. bKash/Nagad get a fake transaction id.
  route('POST', '/api/bookings/:id/pay', ctx => {
    const u = needApproved(ctx);
    const { b } = bookingAccess(u, Number(ctx.params.id));
    if (u.id !== b.rider_id) throw forbidden('Only the rider pays');
    if (b.status !== 'accepted') throw bad('Pay after the driver accepts your request');
    if (b.pay_status === 'paid') throw bad('Already paid');
    const method = ctx.body.method;
    if (!['bkash', 'nagad', 'cash'].includes(method)) throw bad('Choose bKash, Nagad or cash');
    if (method === 'cash') {
      db.prepare("UPDATE bookings SET pay_method='cash' WHERE id=?").run(b.id);
    } else {
      db.prepare("UPDATE bookings SET pay_method=?, pay_status='paid', txn_id=? WHERE id=?").run(method, 'SBX-' + randomBytes(5).toString('hex').toUpperCase(), b.id);
    }
    return { data: { booking: bookingView(q.booking.get(b.id)) } };
  });

  // --- safety ---
  route('POST', '/api/sos', ctx => {
    const u = needApproved(ctx);
    const rideId = ctx.body.ride_id ? Number(ctx.body.ride_id) : null;
    if (rideId) {
      const r = q.ride.get(rideId);
      if (!r || !participant(u, r)) throw forbidden('You are not on that ride');
    }
    const lat = Number.isFinite(Number(ctx.body.lat)) ? Number(ctx.body.lat) : null;
    const lng = Number.isFinite(Number(ctx.body.lng)) ? Number(ctx.body.lng) : null;
    const info = db.prepare('INSERT INTO sos (user_id,ride_id,lat,lng,message) VALUES (?,?,?,?,?)').run(u.id, rideId, lat, lng, String(ctx.body.message || '').trim().slice(0, 200));
    return { status: 201, data: { id: Number(info.lastInsertRowid) } };
  });

  route('POST', '/api/complaints', ctx => {
    const u = needApproved(ctx);
    const against = int(ctx.body.against_id, 'Person', 1, 1e9);
    if (against === u.id || !q.userById.get(against)) throw bad('Pick a valid person to report');
    const info = db.prepare('INSERT INTO complaints (from_id,against_id,ride_id,body) VALUES (?,?,?,?)').run(
      u.id, against, ctx.body.ride_id ? Number(ctx.body.ride_id) : null, str(ctx.body.body, 'Details', { min: 10, max: 600 }));
    return { status: 201, data: { id: Number(info.lastInsertRowid) } };
  });

  // --- admin ---
  route('GET', '/api/admin/stats', ctx => {
    needAdmin(ctx);
    const n = sql => db.prepare(sql).get().n;
    return { data: {
      users: n("SELECT COUNT(*) n FROM users WHERE role='student'"),
      pending_users: n("SELECT COUNT(*) n FROM users WHERE status='pending'"),
      pending_drivers: n("SELECT COUNT(*) n FROM vehicles WHERE status='pending'"),
      rides: n('SELECT COUNT(*) n FROM rides'),
      completed: n("SELECT COUNT(*) n FROM rides WHERE status='done'"),
      open_complaints: n("SELECT COUNT(*) n FROM complaints WHERE status='open'"),
      open_sos: n('SELECT COUNT(*) n FROM sos WHERE resolved=0'),
    } };
  });

  route('GET', '/api/admin/users', ctx => {
    needAdmin(ctx);
    const status = ctx.query.status;
    const rows = status
      ? db.prepare("SELECT id,name,email,student_id,phone,status,created_at FROM users WHERE role='student' AND status=? ORDER BY id DESC LIMIT 200").all(status)
      : db.prepare("SELECT id,name,email,student_id,phone,status,created_at FROM users WHERE role='student' ORDER BY id DESC LIMIT 200").all();
    return { data: { users: rows } };
  });

  route('PATCH', '/api/admin/users/:id', ctx => {
    const admin = needAdmin(ctx);
    const id = Number(ctx.params.id);
    if (id === admin.id) throw bad('You cannot change your own status');
    const status = ctx.body.status;
    if (!['approved', 'rejected', 'banned', 'pending'].includes(status)) throw bad('Invalid status');
    const t = q.userById.get(id);
    if (!t || t.role === 'admin') throw notFound('User not found');
    db.prepare('UPDATE users SET status=? WHERE id=?').run(status, id);
    return { data: { user: q.userById.get(id) } };
  });

  route('GET', '/api/admin/drivers', ctx => {
    needAdmin(ctx);
    const rows = db.prepare('SELECT v.user_id,u.name,u.student_id,v.model,v.plate,v.license_no,v.status FROM vehicles v JOIN users u ON u.id=v.user_id ORDER BY (v.status=\'pending\') DESC, v.created_at DESC LIMIT 200').all();
    return { data: { drivers: rows } };
  });

  route('PATCH', '/api/admin/drivers/:id', ctx => {
    needAdmin(ctx);
    const status = ctx.body.status;
    if (!['approved', 'rejected'].includes(status)) throw bad('Invalid status');
    const r = db.prepare('UPDATE vehicles SET status=? WHERE user_id=?').run(status, Number(ctx.params.id));
    if (!r.changes) throw notFound('Driver profile not found');
    return { data: { ok: true } };
  });

  route('GET', '/api/admin/complaints', ctx => {
    needAdmin(ctx);
    const rows = db.prepare(`SELECT c.id,c.body,c.status,c.created_at,c.ride_id,f.name AS from_name,a.name AS against_name,a.id AS against_id
      FROM complaints c JOIN users f ON f.id=c.from_id JOIN users a ON a.id=c.against_id ORDER BY (c.status='open') DESC, c.id DESC LIMIT 200`).all();
    return { data: { complaints: rows } };
  });

  route('PATCH', '/api/admin/complaints/:id', ctx => {
    needAdmin(ctx);
    db.prepare("UPDATE complaints SET status='resolved' WHERE id=?").run(Number(ctx.params.id));
    return { data: { ok: true } };
  });

  route('GET', '/api/admin/sos', ctx => {
    needAdmin(ctx);
    const rows = db.prepare('SELECT s.id,s.ride_id,s.lat,s.lng,s.message,s.resolved,s.created_at,u.name,u.phone FROM sos s JOIN users u ON u.id=s.user_id ORDER BY s.resolved, s.id DESC LIMIT 100').all();
    return { data: { sos: rows } };
  });

  route('PATCH', '/api/admin/sos/:id', ctx => {
    needAdmin(ctx);
    db.prepare('UPDATE sos SET resolved=1 WHERE id=?').run(Number(ctx.params.id));
    return { data: { ok: true } };
  });

  // ---------- http plumbing ----------
  const send = (res, status, data, extra = {}) => {
    const body = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...extra });
    res.end(body);
  };

  const readBody = req => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 100_000) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' ? v : {}); }
      catch { reject(bad('Invalid JSON')); }
    });
    req.on('error', reject);
  });

  async function handleApi(req, res, url) {
    const match = routes.find(r => r.method === req.method && r.re.test(url.pathname));
    if (!match) {
      if (routes.some(r => r.re.test(url.pathname))) throw new HttpError(405, 'Method not allowed');
      throw notFound('Unknown API route');
    }
    if (req.method !== 'GET' && !String(req.headers['content-type'] || '').startsWith('application/json') && Number(req.headers['content-length'] || 0) > 0) {
      throw new HttpError(415, 'Send JSON');
    }
    const m = url.pathname.match(match.re);
    const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const uid = readToken(secret, parseCookies(req.headers.cookie).cc_session);
    let user = uid ? q.userById.get(uid) : null;
    if (user && user.status === 'banned') user = null;
    const body = req.method === 'GET' ? {} : await readBody(req);
    const ctx = { req, res, user, params, body, query: Object.fromEntries(url.searchParams), ip: req.socket.remoteAddress || '?' };
    const out = match.handler(ctx);
    send(res, out.status || 200, out.data);
  }

  function serveStatic(req, res, url) {
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    const rel = normalize(decodeURIComponent(p)).replace(/^([/\\])+/, '');
    const file = join(publicDir, rel);
    if (!file.startsWith(publicDir) || !existsSync(file) || !MIME[extname(file)]) {
      res.writeHead(404, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)], 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
    res.end(readFileSync(file));
  }

  async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
      else throw new HttpError(405, 'Method not allowed');
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      const status = e instanceof HttpError ? e.status : 500;
      if (!res.headersSent) send(res, status, { error: e instanceof HttpError ? e.message : 'Something went wrong' });
    }
  }

  return { handler, db };
}

export function loadSecret(dataDir) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = join(dataDir, 'session.secret');
  if (existsSync(f)) return readFileSync(f, 'utf8').trim();
  mkdirSync(dirname(f), { recursive: true });
  const s = randomBytes(32).toString('hex');
  writeFileSync(f, s, { mode: 0o600 });
  return s;
}

export function ensureAdmin(db, { email, password }) {
  const row = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
  if (row) return null;
  const pw = password || randomBytes(6).toString('base64url');
  db.prepare("INSERT INTO users (name,email,pass_hash,student_id,role,status) VALUES ('Admin',?,?, 'ADMIN', 'admin','approved')").run(email, hashPassword(pw));
  return password ? null : pw;
}
