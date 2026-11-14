// Campus-Cruise front end: vanilla ES modules, hash routing, no inline scripts (strict CSP).
const $ = sel => document.querySelector(sel);
const app = $('#app');
let me = null;          // { user, vehicle, rating, routines }
let timers = [];

// ---------- tiny helpers ----------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const money = n => `৳${n}`;
const fmtTime = s => new Date(s.replace(' ', 'T') + 'Z').toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const toLocalInput = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

let toastTimer;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

async function api(method, path, body) {
  const res = await fetch('/api' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && me) { me = null; location.hash = '#/login'; }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const act = (fn, ok) => async e => {
  const btn = e?.currentTarget; if (btn) btn.disabled = true;
  try { await fn(e); if (ok) toast(ok); } catch (err) { toast(err.message, true); } finally { if (btn) btn.disabled = false; }
};
const every = (ms, fn) => timers.push(setInterval(fn, ms));
const clearTimers = () => { timers.forEach(clearInterval); timers = []; };

function field(label, props = {}, tag = 'input') {
  const id = 'f' + Math.random().toString(36).slice(2, 8);
  const el = h(tag, { id, ...props });
  return { el, node: h('div', {}, h('label', { for: id }, label), el) };
}
const pill = (text, kind = '') => h('span', { class: 'pill ' + kind }, text);
const statusPill = s => pill(s, { approved: 'ok', accepted: 'ok', open: 'ok', done: 'ok', paid: 'ok', pending: 'warn', started: 'warn', unpaid: 'warn', rejected: 'bad', cancelled: 'bad', banned: 'bad' }[s] || '');
const stars = r => r && r.n ? `★ ${r.avg} (${r.n})` : 'New';

// ---------- chrome ----------
function renderChrome() {
  const bar = $('#topbar'), tabs = $('#tabbar');
  bar.replaceChildren(h('div', { class: 'in' },
    h('a', { class: 'brand', href: '#/' }, h('img', { src: '/logo.png', alt: '' }), 'Campus-Cruise'),
    h('span', { class: 'grow' }),
    me ? h('button', { class: 'ghost small', onclick: act(async () => { await api('POST', '/logout'); me = null; location.hash = '#/login'; }) }, 'Log out') : null));
  tabs.replaceChildren();
  if (!me) return;
  const items = me.user.role === 'admin'
    ? [['#/admin', '🛡️', 'Admin']]
    : [['#/', '🔎', 'Find'], ['#/trips', '🏍️', 'My trips'], ['#/drive', '🛵', 'Drive'], ['#/profile', '👤', 'Profile']];
  const cur = location.hash || '#/';
  for (const [href, icon, label] of items) tabs.append(h('a', { href, class: cur === href ? 'on' : '' }, h('span', {}, icon), label));
}

async function loadMe() { try { me = await api('GET', '/me'); } catch { me = null; } }
const approved = () => me && me.user.status === 'approved';
const isDriver = () => approved() && me.vehicle && me.vehicle.status === 'approved';

function pendingBanner() {
  if (!me) return null;
  if (me.user.status === 'pending') return h('div', { class: 'banner' }, '⏳ Your student account is waiting for admin verification. You can use Campus-Cruise as soon as it is approved.');
  if (me.user.status === 'rejected') return h('div', { class: 'banner' }, 'Your verification was rejected. Check your student ID and contact the admin.');
  return null;
}

// ---------- pages ----------
function authPage(mode) {
  const reg = mode === 'register';
  const f = {
    name: field('Full name', { autocomplete: 'name' }),
    email: field('UIU email', { type: 'email', placeholder: 'you@bscse.uiu.ac.bd', autocomplete: 'email' }),
    sid: field('Student ID', { inputmode: 'numeric' }),
    phone: field('Phone', { type: 'tel', autocomplete: 'tel' }),
    pw: field('Password', { type: 'password', minlength: 8, autocomplete: reg ? 'new-password' : 'current-password' }),
  };
  const submit = act(async () => {
    const body = reg
      ? { name: f.name.el.value, email: f.email.el.value, student_id: f.sid.el.value, phone: f.phone.el.value, password: f.pw.el.value }
      : { email: f.email.el.value, password: f.pw.el.value };
    await api('POST', reg ? '/register' : '/login', body);
    await loadMe(); location.hash = me.user.role === 'admin' ? '#/admin' : '#/';
  });
  return h('div', { class: 'auth card stack' },
    h('img', { class: 'logo', src: '/logo.png', alt: 'Campus-Cruise logo' }),
    h('h1', { class: 'center' }, reg ? 'Join Campus-Cruise' : 'Welcome back'),
    h('p', { class: 'muted center' }, 'Safe · Affordable · Community. Only for verified UIU students.'),
    reg ? [f.name.node, f.email.node, f.sid.node, f.phone.node, f.pw.node] : [f.email.node, f.pw.node],
    h('button', { class: 'block', onclick: submit }, reg ? 'Create account' : 'Log in'),
    h('p', { class: 'center muted' }, reg ? 'Already verified? ' : 'New here? ', h('a', { href: reg ? '#/login' : '#/register' }, reg ? 'Log in' : 'Create an account')));
}

function rideCard(r) {
  return h('a', { class: 'card stack', href: `#/ride/${r.id}`, style: null },
    h('div', { class: 'row between' },
      h('div', {}, h('h3', {}, `${r.origin} → ${r.destination}`), h('div', { class: 'muted' }, fmtTime(r.depart_at))),
      h('div', { class: 'center' }, h('div', { class: 'price' }, money(r.fare)), h('div', { class: 'muted' }, 'per seat'))),
    h('div', { class: 'row wrap' },
      pill(`${r.seats_left} seat${r.seats_left === 1 ? '' : 's'} left`, 'ok'),
      r.match ? pill(`${r.match}% match`) : null,
      h('span', { class: 'muted' }, `${r.driver.name} · ${stars(r.driver.rating)}${r.vehicle ? ' · ' + r.vehicle.model : ''}`)));
}

async function findPage() {
  const banner = pendingBanner();
  if (!approved()) return h('div', {}, banner, h('div', { class: 'empty' }, 'Ride search unlocks after verification.'));
  const list = h('div'), rec = h('div');
  const from = field('Pickup', { placeholder: 'e.g. Aftabnagar' }), to = field('Going to', { placeholder: 'e.g. UIU' });
  const fare = field('Max fare (৳)', { type: 'number', min: 0 }), date = field('Date', { type: 'date' });
  const search = act(async () => {
    const qs = new URLSearchParams({ from: from.el.value, to: to.el.value, max_fare: fare.el.value, date: date.el.value });
    const { rides } = await api('GET', '/rides?' + qs);
    list.replaceChildren(...(rides.length ? rides.map(rideCard) : [h('div', { class: 'empty' }, 'No rides match yet. Try fewer filters.')]));
  });
  (async () => {
    const { rides, hint } = await api('GET', '/rides/recommended');
    rec.replaceChildren(rides.length ? h('div', {}, h('h2', {}, '✨ Matched to your class routine'), ...rides.map(rideCard))
      : hint ? h('div', { class: 'banner' }, hint + '. ', h('a', { href: '#/profile' }, 'Open profile')) : null);
  })().catch(() => {});
  search();
  return h('div', {},
    h('div', { class: 'hero' }, h('h1', {}, `Hi ${me.user.name.split(' ')[0]} 👋`), h('p', {}, 'Find a bike ride to campus from a verified student.')),
    rec,
    h('div', { class: 'card stack' }, h('div', { class: 'grid2' }, from.node, to.node), h('div', { class: 'grid2' }, fare.node, date.node), h('button', { class: 'block', onclick: search }, 'Search rides')),
    h('h2', {}, 'Available rides'), list);
}

async function ridePage(id) {
  const { ride, booking, bookings } = await api('GET', `/rides/${id}`);
  const mine = ride.driver_id === me.user.id;
  const seats = field('Seats', { type: 'number', min: 1, max: Math.max(1, Math.min(3, ride.seats_left)), value: 1 });
  const reload = () => route();
  const parts = [
    h('a', { href: mine ? '#/drive' : '#/' }, '← Back'),
    h('div', { class: 'card stack' },
      h('div', { class: 'row between' }, h('h1', {}, `${ride.origin} → ${ride.destination}`), statusPill(ride.status)),
      h('div', { class: 'muted' }, fmtTime(ride.depart_at)),
      h('div', { class: 'row between' }, h('span', { class: 'price' }, `${money(ride.fare)} / seat`), pill(`${ride.seats_left} of ${ride.seats} seats free`, 'ok')),
      ride.note ? h('p', {}, ride.note) : null,
      h('div', { class: 'muted' }, `Driver: ${ride.driver.name} · ${stars(ride.driver.rating)}`, ride.vehicle ? ` · ${ride.vehicle.model} (${ride.vehicle.plate})` : '')),
  ];
  if (!mine) {
    if (booking && ['pending', 'accepted'].includes(booking.status)) {
      parts.push(h('div', { class: 'card stack' }, h('div', { class: 'row between' }, h('h2', {}, 'Your request'), statusPill(booking.status)),
        h('a', { class: 'btn block', href: `#/chat/${booking.id}` }, booking.status === 'accepted' ? 'Open trip' : 'Chat with driver')));
    } else if (ride.status === 'open' && ride.seats_left > 0) {
      parts.push(h('div', { class: 'card stack' }, h('h2', {}, 'Request this ride'), h('p', { class: 'muted' }, 'The driver reviews every request before it is confirmed.'), seats.node,
        h('button', { class: 'block', onclick: act(async () => { const r = await api('POST', `/rides/${id}/bookings`, { seats: Number(seats.el.value) }); location.hash = `#/chat/${r.booking.id}`; }) }, 'Send request')));
    }
    parts.push(reportCard(ride.driver_id, ride.id, ride.driver.name));
  } else {
    parts.push(h('h2', {}, 'Requests'), ...(bookings.length ? bookings.map(b => bookingRow(b, reload)) : [h('div', { class: 'empty' }, 'No requests yet.')]));
  }
  return h('div', {}, ...parts);
}

function bookingRow(b, reload) {
  const ride = b.ride;
  const doIt = (action, ok) => act(async () => { await api('PATCH', `/bookings/${b.id}`, { action }); reload(); }, ok);
  return h('div', { class: 'card stack' },
    h('div', { class: 'row between' }, h('b', {}, `${b.rider.name} · ${b.seats} seat${b.seats > 1 ? 's' : ''}`), statusPill(b.status)),
    h('div', { class: 'muted' }, `${money(b.fare)} · ${b.pay_status === 'paid' ? 'paid via ' + b.pay_method : b.pay_method === 'cash' ? 'cash on ride' : 'unpaid'}`),
    h('div', { class: 'row wrap' },
      b.status === 'pending' ? [h('button', { class: 'small', onclick: doIt('accept', 'Accepted') }, 'Accept'), h('button', { class: 'small danger', onclick: doIt('reject', 'Rejected') }, 'Reject')] : null,
      b.pay_method === 'cash' && b.pay_status === 'unpaid' && b.status === 'accepted' ? h('button', { class: 'small', onclick: doIt('cash_received', 'Marked as paid') }, 'Cash received') : null,
      b.status !== 'rejected' && b.status !== 'cancelled' ? h('a', { class: 'btn small ghost', href: `#/chat/${b.id}` }, 'Chat') : null,
      ride.status === 'done' && b.status === 'accepted' ? h('a', { class: 'btn small ghost', href: `#/rate/${ride.id}/${b.rider_id}` }, 'Rate rider') : null));
}

function reportCard(againstId, rideId, name) {
  const body = field('What happened?', { rows: 3 }, 'textarea');
  const box = h('div', { class: 'card stack' });
  box.append(h('button', { class: 'ghost small', onclick: () => box.replaceChildren(h('h3', {}, `Report ${name}`), body.node,
    h('button', { class: 'small danger', onclick: act(async () => { await api('POST', '/complaints', { against_id: againstId, ride_id: rideId, body: body.el.value }); box.replaceChildren(h('p', { class: 'muted' }, 'Report sent to the admins. Thank you.')); }) }, 'Send report')) }, '🚩 Report a problem'));
  return box;
}

async function tripsPage() {
  if (!approved()) return h('div', {}, pendingBanner());
  const { bookings, rated } = await api('GET', '/my/bookings');
  if (!bookings.length) return h('div', { class: 'empty' }, 'No trips yet. ', h('a', { href: '#/' }, 'Find a ride'));
  return h('div', {}, h('h1', {}, 'My trips'), ...bookings.map(b => {
    const r = b.ride;
    const hasRated = rated.some(x => x.ride_id === r.id && x.to_id === r.driver_id);
    return h('div', { class: 'card stack' },
      h('div', { class: 'row between' }, h('h3', {}, `${r.origin} → ${r.destination}`), statusPill(b.status)),
      h('div', { class: 'muted' }, `${fmtTime(r.depart_at)} · ${r.driver.name}`),
      h('div', { class: 'row between' }, h('b', {}, money(b.fare)), pill(b.pay_status === 'paid' ? 'paid' : 'unpaid', b.pay_status === 'paid' ? 'ok' : 'warn'), statusPill(r.status)),
      h('div', { class: 'row wrap' },
        b.status === 'cancelled' || b.status === 'rejected' ? null : h('a', { class: 'btn small', href: `#/chat/${b.id}` }, b.status === 'accepted' ? 'Open trip' : 'Chat'),
        r.status === 'done' && b.status === 'accepted' && !hasRated ? h('a', { class: 'btn small ghost', href: `#/rate/${r.id}/${r.driver_id}` }, 'Rate driver') : null));
  }));
}

async function chatPage(id) {
  const first = await api('GET', `/bookings/${id}/messages`);
  const { bookings } = await api('GET', '/my/bookings').catch(() => ({ bookings: [] }));
  let bk = bookings.find(b => b.id === Number(id));
  if (!bk) { // driver viewing a rider's booking
    const { rides } = await api('GET', '/my/rides');
    for (const r of rides) { const f = r.bookings.find(b => b.id === Number(id)); if (f) bk = f; }
  }
  if (!bk) throw new Error('Booking not found');
  const ride = bk.ride, isRider = bk.rider_id === me.user.id;
  const list = h('div', { class: 'msgs' }), fareEl = h('span', { class: 'price' });
  const render = ({ messages, fare }) => {
    fareEl.textContent = money(fare);
    list.replaceChildren(...messages.map(m => h('div', { class: 'msg' + (m.sender_id === me.user.id ? ' me' : '') },
      h('div', { class: 'who' }, m.sender), m.body,
      m.offer != null ? h('div', { class: 'row' }, pill(money(m.offer), m.accepted ? 'ok' : ''), m.accepted ? pill('agreed', 'ok')
        : m.sender_id !== me.user.id ? h('button', { class: 'small', onclick: act(async () => { await api('POST', `/messages/${m.id}/accept`); await refresh(); }, 'Fare updated') }, 'Accept') : null) : null)));
    list.scrollTop = list.scrollHeight;
  };
  const refresh = async () => render(await api('GET', `/bookings/${id}/messages`));
  render(first);
  every(4000, () => refresh().catch(() => {}));
  const text = field('Message', { placeholder: 'Pickup spot, timing…' }), offer = field('Offer a fare (৳)', { type: 'number', min: 0 });
  const send = act(async () => {
    await api('POST', `/bookings/${id}/messages`, { body: text.el.value, offer: offer.el.value });
    text.el.value = ''; offer.el.value = ''; await refresh();
  });
  const live = ride.status === 'started' || ride.status === 'done';
  const extra = [];
  if (isRider && bk.status === 'accepted') extra.push(paymentCard(bk));
  if (bk.status === 'accepted') extra.push(trackCard(ride, isRider), sosCard(ride));
  return h('div', {},
    h('a', { href: isRider ? '#/trips' : `#/ride/${ride.id}` }, '← Back'),
    h('div', { class: 'card stack' },
      h('div', { class: 'row between' }, h('h2', {}, `${ride.origin} → ${ride.destination}`), statusPill(bk.status)),
      h('div', { class: 'row between' }, h('span', { class: 'muted' }, `${fmtTime(ride.depart_at)} · with ${isRider ? ride.driver.name : bk.rider.name}`), fareEl),
      live ? h('div', { class: 'muted' }, `Ride is ${ride.status}`) : null),
    ...extra,
    h('div', { class: 'card stack' }, h('h3', {}, 'Chat & fare'), list,
      ['rejected', 'cancelled'].includes(bk.status) ? h('p', { class: 'muted' }, 'This chat is closed.') : [text.node, offer.node, h('button', { class: 'block', onclick: send }, 'Send')]),
    isRider && bk.status === 'pending' ? h('button', { class: 'ghost block', onclick: act(async () => { await api('PATCH', `/bookings/${id}`, { action: 'cancel' }); location.hash = '#/trips'; }) }, 'Cancel request') : null,
    isRider && bk.status === 'accepted' && ride.status === 'open' ? h('button', { class: 'ghost block', onclick: act(async () => { await api('PATCH', `/bookings/${id}`, { action: 'cancel' }); location.hash = '#/trips'; }) }, 'Cancel booking') : null);
}

function paymentCard(bk) {
  const box = h('div', { class: 'card stack' }, h('h3', {}, 'Payment'));
  if (bk.pay_status === 'paid') box.append(h('p', {}, '✅ Paid via ' + bk.pay_method, bk.txn_id ? ` · ${bk.txn_id}` : ''));
  else if (bk.pay_method === 'cash') box.append(h('p', {}, '💵 Pay cash to the driver. They will confirm it in the app.'));
  else {
    const pay = m => act(async () => { await api('POST', `/bookings/${bk.id}/pay`, { method: m }); route(); }, 'Payment recorded');
    box.append(h('p', { class: 'muted' }, 'Demo mode: no real money moves. Real bKash/Nagad needs merchant credentials.'),
      h('div', { class: 'row wrap' }, h('button', { onclick: pay('bkash') }, 'bKash'), h('button', { onclick: pay('nagad') }, 'Nagad'), h('button', { class: 'ghost', onclick: pay('cash') }, 'Cash')));
  }
  return box;
}

function trackCard(ride, isRider) {
  const out = h('p', { class: 'muted' }, 'Tracking starts when the driver starts the ride.');
  const box = h('div', { class: 'card stack' }, h('h3', {}, '📍 Live location'), out);
  const poll = async () => {
    const { status, location: loc } = await api('GET', `/rides/${ride.id}/location`);
    if (!loc) { out.textContent = status === 'started' ? 'Waiting for the driver’s location…' : 'Tracking starts when the driver starts the ride.'; return; }
    out.replaceChildren(`Last seen ${fmtTime(loc.updated_at)} · `, h('a', { href: `https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lng}#map=17/${loc.lat}/${loc.lng}`, target: '_blank', rel: 'noopener noreferrer' }, 'Open on map'));
  };
  poll().catch(() => {}); every(5000, () => poll().catch(() => {}));
  return box;
}

function sosCard(ride) {
  return h('div', { class: 'card stack' }, h('h3', {}, '🆘 Emergency'),
    h('button', { class: 'danger block', onclick: act(async () => {
      if (!confirm('Send an emergency alert to the Campus-Cruise admins with your location?')) return;
      const pos = await new Promise(res => navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => res(p.coords), () => res(null), { timeout: 4000 }) : res(null));
      await api('POST', '/sos', { ride_id: ride.id, lat: pos?.latitude, lng: pos?.longitude, message: 'SOS from ride' });
    }, 'Alert sent to admins. If you are in danger call 999.') }, 'Send SOS'));
}

async function ratePage(rideId, toId) {
  let val = 5;
  const starRow = h('div', { class: 'stars row' });
  const draw = () => starRow.replaceChildren(...[1, 2, 3, 4, 5].map(n => h('button', { class: n <= val ? 'on' : '', 'aria-label': `${n} stars`, onclick: () => { val = n; draw(); } }, '★')));
  draw();
  const comment = field('Comment (optional)', { rows: 3 }, 'textarea');
  return h('div', { class: 'card stack' }, h('h1', {}, 'Rate this trip'), starRow, comment.node,
    h('button', { class: 'block', onclick: act(async () => { await api('POST', `/rides/${rideId}/ratings`, { to_id: Number(toId), stars: val, comment: comment.el.value }); location.hash = '#/trips'; }, 'Thanks for rating!') }, 'Submit'));
}

async function drivePage() {
  if (!approved()) return h('div', {}, pendingBanner());
  if (!isDriver()) return driverApply();
  const { rides } = await api('GET', '/my/rides');
  const reload = () => route();
  const origin = field('Pickup'), dest = field('Destination', { value: 'UIU Campus' });
  const when = field('Departure', { type: 'datetime-local', value: toLocalInput(new Date(Date.now() + 3600e3)) });
  const seats = field('Seats (max 3)', { type: 'number', min: 1, max: 3, value: 1 }), fare = field('Fare per seat (৳)', { type: 'number', min: 0, value: 50 });
  const note = field('Note (optional)', { placeholder: 'Meeting point, helmet available…' });
  return h('div', {},
    h('h1', {}, 'Offer a ride'),
    h('div', { class: 'card stack' }, origin.node, dest.node, h('div', { class: 'grid2' }, when.node, seats.node), fare.node, note.node,
      h('button', { class: 'block', onclick: act(async () => {
        await api('POST', '/rides', { origin: origin.el.value, destination: dest.el.value, depart_at: new Date(when.el.value).toISOString(), seats: Number(seats.el.value), fare: Number(fare.el.value), note: note.el.value });
        reload();
      }, 'Ride posted') }, 'Post ride')),
    h('h2', {}, 'My rides'),
    ...(rides.length ? rides.map(r => driverRide(r, reload)) : [h('div', { class: 'empty' }, 'No rides yet.')]));
}

function driverRide(r, reload) {
  const set = (action, ok) => act(async () => { await api('PATCH', `/rides/${r.id}`, { action }); reload(); }, ok);
  let watch = null;
  const share = h('button', { class: 'small ghost', onclick: () => {
    if (watch != null) { navigator.geolocation.clearWatch(watch); watch = null; share.textContent = '📍 Share location'; return; }
    if (!navigator.geolocation) return toast('Location is not available on this device', true);
    let last = 0;
    watch = navigator.geolocation.watchPosition(p => {
      if (Date.now() - last < 4000) return; last = Date.now();
      api('POST', `/rides/${r.id}/location`, { lat: p.coords.latitude, lng: p.coords.longitude }).catch(() => {});
    }, () => toast('Could not read your location', true), { enableHighAccuracy: true });
    share.textContent = '⏹ Stop sharing';
  } }, '📍 Share location');
  return h('div', { class: 'card stack' },
    h('div', { class: 'row between' }, h('a', { href: `#/ride/${r.id}` }, h('b', {}, `${r.origin} → ${r.destination}`)), statusPill(r.status)),
    h('div', { class: 'muted' }, `${fmtTime(r.depart_at)} · ${money(r.fare)}/seat · ${r.seats_left}/${r.seats} seats free`),
    r.bookings.filter(b => b.status === 'pending').length ? pill(`${r.bookings.filter(b => b.status === 'pending').length} new request(s)`, 'warn') : null,
    h('div', { class: 'row wrap' },
      r.status === 'open' ? [h('button', { class: 'small', onclick: set('start', 'Ride started') }, 'Start ride'), h('button', { class: 'small danger', onclick: set('cancel', 'Ride cancelled') }, 'Cancel')] : null,
      r.status === 'started' ? [h('button', { class: 'small', onclick: set('finish', 'Ride finished') }, 'Finish ride'), share] : null,
      h('a', { class: 'btn small ghost', href: `#/ride/${r.id}` }, 'Requests')));
}

function driverApply() {
  const model = field('Bike model', { placeholder: 'Yamaha R15' }), plate = field('Plate number'), lic = field('Driving licence number');
  const v = me.vehicle;
  return h('div', {}, h('h1', {}, 'Become a driver'),
    v ? h('div', { class: 'banner' }, `Your driver application is ${v.status}.`) : h('p', { class: 'muted' }, 'Submit your bike and licence details. An admin verifies them before you can post rides.'),
    h('div', { class: 'card stack' }, model.node, plate.node, lic.node,
      h('button', { class: 'block', onclick: act(async () => { await api('POST', '/driver/apply', { model: model.el.value, plate: plate.el.value, license_no: lic.el.value }); await loadMe(); route(); }, 'Application sent') }, v ? 'Update & resubmit' : 'Apply')));
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function profilePage() {
  const u = me.user;
  const name = field('Name', { value: u.name }), phone = field('Phone', { value: u.phone, type: 'tel' });
  const rows = h('div', { class: 'stack' });
  const addRow = (r = { weekday: 1, time: '09:00', place: '' }) => {
    const day = h('select', {}, DAYS.map((d, i) => h('option', { value: i, selected: i === r.weekday }, d)));
    const time = h('input', { type: 'time', value: r.time }), place = h('input', { placeholder: 'Place, e.g. UIU or Badda', value: r.place });
    const row = h('div', { class: 'row' }, day, time, place, h('button', { class: 'small ghost', onclick: () => row.remove() }, '✕'));
    row.read = () => ({ weekday: Number(day.value), time: time.value, place: place.value });
    rows.append(row);
  };
  (me.routines.length ? me.routines : []).forEach(addRow);
  return h('div', {},
    pendingBanner(),
    h('div', { class: 'card stack' }, h('h1', {}, u.name), h('div', { class: 'muted' }, `${u.email} · ID ${u.student_id}`),
      h('div', { class: 'row wrap' }, statusPill(u.status), pill(stars(me.rating)), me.vehicle ? pill(`driver: ${me.vehicle.status}`, me.vehicle.status === 'approved' ? 'ok' : 'warn') : null)),
    h('div', { class: 'card stack' }, h('h2', {}, 'Details'), name.node, phone.node,
      h('button', { class: 'block', onclick: act(async () => { await api('PUT', '/me', { name: name.el.value, phone: phone.el.value }); await loadMe(); renderChrome(); }, 'Saved') }, 'Save')),
    approved() ? h('div', { class: 'card stack' }, h('h2', {}, 'Class routine'), h('p', { class: 'muted' }, 'Tell us when and where you usually travel. We match rides to it.'), rows,
      h('div', { class: 'row' }, h('button', { class: 'ghost small', onclick: () => addRow() }, '+ Add'),
        h('button', { class: 'small', onclick: act(async () => { await api('PUT', '/routines', { routines: [...rows.children].map(r => r.read()).filter(r => r.place.trim()) }); await loadMe(); }, 'Routine saved') }, 'Save routine'))) : null,
    approved() && !isDriver() ? h('a', { class: 'btn block', href: '#/drive' }, '🛵 Become a driver') : null);
}

async function adminPage() {
  if (me.user.role !== 'admin') return h('div', { class: 'empty' }, 'Admins only.');
  const body = h('div');
  let tab = 'users';
  const tabs = h('div', { class: 'tabs' });
  const stats = (await api('GET', '/admin/stats'));
  const draw = async () => {
    tabs.replaceChildren(...[['users', 'Students'], ['drivers', 'Drivers'], ['complaints', 'Reports'], ['sos', 'SOS']].map(([k, l]) => h('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; draw(); } }, l)));
    const reload = () => draw();
    const set = (path, status) => act(async () => { await api('PATCH', path, { status }); reload(); });
    if (tab === 'users') {
      const { users } = await api('GET', '/admin/users');
      body.replaceChildren(...users.map(u => h('div', { class: 'card stack' }, h('div', { class: 'row between' }, h('b', {}, u.name), statusPill(u.status)), h('div', { class: 'muted' }, `${u.email} · ID ${u.student_id} · ${u.phone}`),
        h('div', { class: 'row wrap' }, u.status !== 'approved' ? h('button', { class: 'small', onclick: set(`/admin/users/${u.id}`, 'approved') }, 'Approve') : null,
          u.status === 'pending' ? h('button', { class: 'small ghost', onclick: set(`/admin/users/${u.id}`, 'rejected') }, 'Reject') : null,
          u.status !== 'banned' ? h('button', { class: 'small danger', onclick: set(`/admin/users/${u.id}`, 'banned') }, 'Ban') : null))));
      if (!users.length) body.append(h('div', { class: 'empty' }, 'No students yet.'));
    } else if (tab === 'drivers') {
      const { drivers } = await api('GET', '/admin/drivers');
      body.replaceChildren(...drivers.map(d => h('div', { class: 'card stack' }, h('div', { class: 'row between' }, h('b', {}, d.name), statusPill(d.status)), h('div', { class: 'muted' }, `${d.model} · ${d.plate} · licence ${d.license_no}`),
        h('div', { class: 'row' }, d.status !== 'approved' ? h('button', { class: 'small', onclick: set(`/admin/drivers/${d.user_id}`, 'approved') }, 'Approve') : null, d.status !== 'rejected' ? h('button', { class: 'small danger', onclick: set(`/admin/drivers/${d.user_id}`, 'rejected') }, 'Reject') : null))));
      if (!drivers.length) body.append(h('div', { class: 'empty' }, 'No driver applications.'));
    } else if (tab === 'complaints') {
      const { complaints } = await api('GET', '/admin/complaints');
      body.replaceChildren(...complaints.map(c => h('div', { class: 'card stack' }, h('div', { class: 'row between' }, h('b', {}, `${c.from_name} → ${c.against_name}`), statusPill(c.status === 'open' ? 'pending' : 'done')), h('p', {}, c.body),
        c.status === 'open' ? h('button', { class: 'small', onclick: act(async () => { await api('PATCH', `/admin/complaints/${c.id}`); reload(); }) }, 'Mark resolved') : null)));
      if (!complaints.length) body.append(h('div', { class: 'empty' }, 'No reports.'));
    } else {
      const { sos } = await api('GET', '/admin/sos');
      body.replaceChildren(...sos.map(s => h('div', { class: 'card stack' }, h('div', { class: 'row between' }, h('b', {}, `${s.name} · ${s.phone || 'no phone'}`), statusPill(s.resolved ? 'done' : 'bad')), h('div', { class: 'muted' }, `${fmtTime(s.created_at)} · ${s.message}`),
        s.lat != null ? h('a', { href: `https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lng}#map=17/${s.lat}/${s.lng}`, target: '_blank', rel: 'noopener noreferrer' }, 'Open location') : null,
        !s.resolved ? h('button', { class: 'small', onclick: act(async () => { await api('PATCH', `/admin/sos/${s.id}`); reload(); }) }, 'Mark handled') : null)));
      if (!sos.length) body.append(h('div', { class: 'empty' }, 'No alerts.'));
    }
  };
  draw();
  const st = (n, l) => h('div', { class: 'card stat' }, h('b', {}, n), l);
  return h('div', {}, h('h1', {}, 'Admin dashboard'),
    h('div', { class: 'grid2' }, st(stats.pending_users, 'students to verify'), st(stats.pending_drivers, 'drivers to verify'), st(stats.open_complaints, 'open reports'), st(stats.open_sos, 'open SOS')),
    h('p', { class: 'muted' }, `${stats.users} students · ${stats.rides} rides · ${stats.completed} completed`), tabs, body);
}

// ---------- router ----------
async function route() {
  clearTimers();
  const hash = location.hash.replace(/^#/, '') || '/';
  const [, a, b, c] = hash.split('/');
  if (!me) await loadMe();
  renderChrome();
  if (!me && hash !== '/register') { app.replaceChildren(authPage('login')); return; }
  if (me && (hash === '/login' || hash === '/register')) { location.hash = me.user.role === 'admin' ? '#/admin' : '#/'; return; }
  if (!me) { app.replaceChildren(authPage('register')); return; }
  try {
    let view;
    if (a === 'admin') view = await adminPage();
    else if (me.user.role === 'admin') { location.hash = '#/admin'; return; }
    else if (hash === '/' || a === '') view = await findPage();
    else if (a === 'ride') view = await ridePage(b);
    else if (a === 'chat') view = await chatPage(b);
    else if (a === 'rate') view = await ratePage(b, c);
    else if (a === 'trips') view = await tripsPage();
    else if (a === 'drive') view = await drivePage();
    else if (a === 'profile') view = profilePage();
    else view = h('div', { class: 'empty' }, 'Page not found. ', h('a', { href: '#/' }, 'Go home'));
    app.replaceChildren(view);
    window.scrollTo(0, 0);
  } catch (err) {
    app.replaceChildren(h('div', { class: 'card' }, h('p', {}, err.message), h('a', { href: '#/' }, 'Back to home')));
  }
}
window.addEventListener('hashchange', route);
route();
