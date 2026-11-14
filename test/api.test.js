import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApp, ensureAdmin } from '../server/app.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

async function boot() {
  const { handler, db } = createApp({ publicDir, secret: 'test-secret' });
  ensureAdmin(db, { email: 'admin@uiu.ac.bd', password: 'adminpass1' });
  const server = createServer(handler);
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (method, path, body) => {
      const res = await fetch(base + path, {
        method, headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data, headers: res.headers };
    };
    return { get: p => call('GET', p), post: (p, b = {}) => call('POST', p, b), put: (p, b) => call('PUT', p, b), patch: (p, b) => call('PATCH', p, b) };
  };
  return { server, db, client, base };
}

const student = (n, extra = {}) => ({ name: `Student ${n}`, email: `s${n}@bscse.uiu.ac.bd`, password: 'password123', student_id: `011233${n}0${n}`, phone: '01700000000', ...extra });
const inAnHour = () => new Date(Date.now() + 3600e3).toISOString();

async function signedInStudent(ctx, n) {
  const c = ctx.client();
  const r = await c.post('/api/register', student(n));
  assert.equal(r.status, 201);
  return { c, id: r.data.user.id };
}

async function approve(admin, id) {
  const r = await admin.patch(`/api/admin/users/${id}`, { status: 'approved' });
  assert.equal(r.status, 200);
}

async function setup() {
  const ctx = await boot();
  const admin = ctx.client();
  assert.equal((await admin.post('/api/login', { email: 'admin@uiu.ac.bd', password: 'adminpass1' })).status, 200);
  const driver = await signedInStudent(ctx, 1);
  const rider = await signedInStudent(ctx, 2);
  await approve(admin, driver.id);
  await approve(admin, rider.id);
  assert.equal((await driver.c.post('/api/driver/apply', { model: 'Yamaha R15', plate: 'DHAKA-METRO-LA-1234', license_no: 'DL-998877' })).status, 201);
  assert.equal((await admin.patch(`/api/admin/drivers/${driver.id}`, { status: 'approved' })).status, 200);
  return { ctx, admin, driver, rider };
}

test('registration only accepts official UIU emails and starts as pending', async () => {
  const ctx = await boot();
  const c = ctx.client();
  const bad = await c.post('/api/register', student(1, { email: 'someone@gmail.com' }));
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /UIU email/);
  const ok = await c.post('/api/register', student(1));
  assert.equal(ok.status, 201);
  assert.equal(ok.data.user.status, 'pending');
  assert.equal((await c.post('/api/register', student(1))).status, 409);
  const rides = await c.get('/api/rides');
  assert.equal(rides.status, 403, 'pending users cannot use ride features');
  ctx.server.closeAllConnections(); ctx.server.close();
});

test('login rejects wrong passwords and anonymous users get 401', async () => {
  const ctx = await boot();
  const c = ctx.client();
  assert.equal((await c.get('/api/me')).status, 401);
  assert.equal((await c.post('/api/login', { email: 'admin@uiu.ac.bd', password: 'nope' })).status, 401);
  assert.equal((await c.post('/api/login', { email: 'admin@uiu.ac.bd', password: 'adminpass1' })).status, 200);
  assert.equal((await c.get('/api/me')).data.user.role, 'admin');
  ctx.server.closeAllConnections(); ctx.server.close();
});

test('forged or tampered session cookies are rejected', async () => {
  const ctx = await boot();
  const res = await fetch(ctx.base + '/api/me', { headers: { Cookie: 'cc_session=1.99999999999999.AAAA' } });
  assert.equal(res.status, 401);
  ctx.server.closeAllConnections(); ctx.server.close();
});

test('non-admins cannot reach admin routes; only approved drivers can post rides', async () => {
  const { ctx, rider } = await setup();
  assert.equal((await rider.c.get('/api/admin/stats')).status, 403);
  const r = await rider.c.post('/api/rides', { origin: 'A', destination: 'B', depart_at: inAnHour(), seats: 2, fare: 50 });
  assert.equal(r.status, 403);
  ctx.server.closeAllConnections(); ctx.server.close();
});

test('full ride lifecycle: post, search, book, accept, negotiate, pay, track, finish, rate', async () => {
  const { ctx, driver, rider } = await setup();

  const posted = await driver.c.post('/api/rides', { origin: 'Aftabnagar', destination: 'UIU Campus', depart_at: inAnHour(), seats: 2, fare: 60, note: 'Leaving from the gate' });
  assert.equal(posted.status, 201);
  const rideId = posted.data.ride.id;
  assert.equal(posted.data.ride.seats_left, 2);

  const found = await rider.c.get('/api/rides?to=UIU&max_fare=100');
  assert.equal(found.data.rides.length, 1);
  assert.equal((await rider.c.get('/api/rides?to=Nowhere')).data.rides.length, 0);

  assert.equal((await driver.c.post(`/api/rides/${rideId}/bookings`, { seats: 1 })).status, 400, 'driver cannot book own ride');
  const booked = await rider.c.post(`/api/rides/${rideId}/bookings`, { seats: 1 });
  assert.equal(booked.status, 201);
  assert.equal(booked.data.booking.fare, 60);
  const bookingId = booked.data.booking.id;
  assert.equal((await rider.c.post(`/api/rides/${rideId}/bookings`, { seats: 1 })).status, 409, 'no duplicate requests');

  assert.equal((await rider.c.post(`/api/bookings/${bookingId}/pay`, { method: 'bkash' })).status, 400, 'cannot pay before acceptance');
  assert.equal((await rider.c.patch(`/api/bookings/${bookingId}`, { action: 'accept' })).status, 403, 'rider cannot accept');
  assert.equal((await driver.c.patch(`/api/bookings/${bookingId}`, { action: 'accept' })).status, 200);
  assert.equal((await rider.c.get(`/api/rides/${rideId}`)).data.ride.seats_left, 1);

  // fare negotiation
  const offer = await rider.c.post(`/api/bookings/${bookingId}/messages`, { body: 'Can you do 50?', offer: 50 });
  assert.equal(offer.status, 201);
  assert.equal((await rider.c.post(`/api/messages/${offer.data.id}/accept`)).status, 400, 'cannot accept own offer');
  assert.equal((await driver.c.post(`/api/messages/${offer.data.id}/accept`)).data.fare, 50);
  const chat = await rider.c.get(`/api/bookings/${bookingId}/messages`);
  assert.equal(chat.data.fare, 50);
  assert.equal(chat.data.messages.length, 1);

  // sandbox online payment
  const paid = await rider.c.post(`/api/bookings/${bookingId}/pay`, { method: 'nagad' });
  assert.equal(paid.data.booking.pay_status, 'paid');
  assert.match(paid.data.booking.txn_id, /^SBX-/);
  assert.equal((await driver.c.post(`/api/messages/${offer.data.id}/accept`)).status, 400, 'fare locked after payment');

  // live tracking only once the ride has started
  assert.equal((await driver.c.post(`/api/rides/${rideId}/location`, { lat: 23.8, lng: 90.4 })).status, 400);
  assert.equal((await driver.c.patch(`/api/rides/${rideId}`, { action: 'start' })).status, 200);
  assert.equal((await driver.c.post(`/api/rides/${rideId}/location`, { lat: 23.81, lng: 90.42 })).status, 200);
  const loc = await rider.c.get(`/api/rides/${rideId}/location`);
  assert.equal(loc.data.location.lat, 23.81);
  assert.equal((await driver.c.post(`/api/rides/${rideId}/location`, { lat: 999, lng: 0 })).status, 400);

  // SOS from a rider on the ride
  const sos = await rider.c.post('/api/sos', { ride_id: rideId, lat: 23.8, lng: 90.4, message: 'Test alert' });
  assert.equal(sos.status, 201);

  // rating needs a finished ride
  assert.equal((await rider.c.post(`/api/rides/${rideId}/ratings`, { to_id: driver.id, stars: 5 })).status, 400);
  assert.equal((await driver.c.patch(`/api/rides/${rideId}`, { action: 'finish' })).status, 200);
  const rated = await rider.c.post(`/api/rides/${rideId}/ratings`, { to_id: driver.id, stars: 5, comment: 'Safe ride' });
  assert.equal(rated.status, 201);
  assert.equal(rated.data.rating.avg, 5);
  assert.equal((await rider.c.post(`/api/rides/${rideId}/ratings`, { to_id: driver.id, stars: 4 })).status, 409);
  assert.equal((await driver.c.post(`/api/rides/${rideId}/ratings`, { to_id: rider.id, stars: 4 })).status, 201);

  ctx.server.closeAllConnections(); ctx.server.close();
});

test('seats cannot be oversold and cash payments need driver confirmation', async () => {
  const { ctx, admin, driver, rider } = await setup();
  const third = await signedInStudent(ctx, 3);
  await approve(admin, third.id);
  const { data } = await driver.c.post('/api/rides', { origin: 'Badda', destination: 'UIU Campus', depart_at: inAnHour(), seats: 1, fare: 40 });
  const rideId = data.ride.id;
  const b1 = (await rider.c.post(`/api/rides/${rideId}/bookings`, { seats: 1 })).data.booking.id;
  const b2 = (await third.c.post(`/api/rides/${rideId}/bookings`, { seats: 1 })).data.booking.id;
  assert.equal((await driver.c.patch(`/api/bookings/${b1}`, { action: 'accept' })).status, 200);
  assert.equal((await driver.c.patch(`/api/bookings/${b2}`, { action: 'accept' })).status, 400, 'last seat already taken');

  await rider.c.post(`/api/bookings/${b1}/pay`, { method: 'cash' });
  let mine = (await rider.c.get('/api/my/bookings')).data.bookings[0];
  assert.equal(mine.pay_status, 'unpaid');
  await driver.c.patch(`/api/bookings/${b1}`, { action: 'cash_received' });
  mine = (await rider.c.get('/api/my/bookings')).data.bookings[0];
  assert.equal(mine.pay_status, 'paid');
  ctx.server.closeAllConnections(); ctx.server.close();
});

test('cancelling a ride cancels its bookings; strangers cannot read someone else\'s chat', async () => {
  const { ctx, admin, driver, rider } = await setup();
  const stranger = await signedInStudent(ctx, 4);
  await approve(admin, stranger.id);
  const rideId = (await driver.c.post('/api/rides', { origin: 'X', destination: 'UIU', depart_at: inAnHour(), seats: 2, fare: 30 })).data.ride.id;
  const bid = (await rider.c.post(`/api/rides/${rideId}/bookings`, { seats: 1 })).data.booking.id;
  assert.equal((await stranger.c.get(`/api/bookings/${bid}/messages`)).status, 403);
  assert.equal((await driver.c.patch(`/api/rides/${rideId}`, { action: 'cancel' })).status, 200);
  assert.equal((await rider.c.get('/api/my/bookings')).data.bookings[0].status, 'cancelled');
  ctx.server.closeAllConnections(); ctx.server.close();
});

test('smart matching recommends rides that fit the saved class routine', async () => {
  const { ctx, driver, rider } = await setup();
  const when = new Date(Date.now() + 2 * 3600e3);
  const hh = String(when.getUTCHours()).padStart(2, '0');
  const mm = String(when.getUTCMinutes()).padStart(2, '0');
  await driver.c.post('/api/rides', { origin: 'Mirpur', destination: 'UIU Campus', depart_at: when.toISOString(), seats: 2, fare: 70 });
  await driver.c.post('/api/rides', { origin: 'Sylhet', destination: 'Chittagong', depart_at: when.toISOString(), seats: 2, fare: 900 });
  assert.equal((await rider.c.get('/api/rides/recommended')).data.rides.length, 0);
  const saved = await rider.c.put('/api/routines', { routines: [{ weekday: when.getUTCDay(), time: `${hh}:${mm}`, place: 'UIU' }] });
  assert.equal(saved.status, 200);
  const rec = (await rider.c.get('/api/rides/recommended')).data.rides;
  assert.equal(rec.length, 1);
  assert.equal(rec[0].destination, 'UIU Campus');
  assert.ok(rec[0].match >= 60);
  assert.equal((await rider.c.put('/api/routines', { routines: [{ weekday: 1, time: '9am', place: 'UIU' }] })).status, 400);
  ctx.server.closeAllConnections(); ctx.server.close();
});

test('complaints and SOS reach the admin dashboard', async () => {
  const { ctx, admin, driver, rider } = await setup();
  assert.equal((await rider.c.post('/api/complaints', { against_id: driver.id, body: 'Driver was rude at pickup' })).status, 201);
  assert.equal((await rider.c.post('/api/complaints', { against_id: rider.id, body: 'Reporting myself is invalid' })).status, 400);
  await rider.c.post('/api/sos', { message: 'Need help' });
  const stats = (await admin.get('/api/admin/stats')).data;
  assert.equal(stats.open_complaints, 1);
  assert.equal(stats.open_sos, 1);
  const list = (await admin.get('/api/admin/complaints')).data.complaints;
  await admin.patch(`/api/admin/complaints/${list[0].id}`);
  assert.equal((await admin.get('/api/admin/stats')).data.open_complaints, 0);
  ctx.server.closeAllConnections(); ctx.server.close();
});

test('banned students lose access immediately', async () => {
  const { ctx, admin, rider } = await setup();
  assert.equal((await rider.c.get('/api/rides')).status, 200);
  await admin.patch(`/api/admin/users/${rider.id}`, { status: 'banned' });
  assert.equal((await rider.c.get('/api/rides')).status, 401);
  ctx.server.closeAllConnections(); ctx.server.close();
});

test('static files are served with a strict CSP and path traversal is blocked', async () => {
  const ctx = await boot();
  const res = await fetch(ctx.base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await fetch(ctx.base + '/..%2fserver%2fapp.js')).status, 404);
  assert.equal((await fetch(ctx.base + '/nope.html')).status, 404);
  ctx.server.closeAllConnections(); ctx.server.close();
});
