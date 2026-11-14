<p align="center">
  <img src="docs/logo.png" width="140" alt="Campus-Cruise logo">
</p>

# 🏍️ Campus-Cruise

**A verified, students-only ride-sharing platform for United International University (UIU).**
Students with bikes offer rides, fellow students book them, and everyone stays inside a trusted campus community.

> Started as the **System Analysis & Design Lab (CSE 3411)** project at UIU (full SRS, system models, Figma prototype) and now also a working full-stack app.

## Why Campus-Cruise?

Commuting to campus is expensive, slow and sometimes unsafe. Commercial apps such as Uber and Pathao don't offer the trust of travelling with verified classmates. Campus-Cruise connects UIU students who own bikes with students heading the same way, at fair prices.

## Key features

- **Verified access only**: UIU email registration, student ID check, driving-licence check for drivers, admin approval before activation
- **Ride posting and search**: pickup, destination, schedule, seats and fare; filter by route and time
- **Driver-approved bookings**: every request is accepted or rejected by the driver
- **Smart matching**: suggests rides from route similarity and uploaded class routines
- **In-app chat and fare negotiation**
- **Payments**: bKash, Nagad or cash
- **Live GPS tracking and Emergency SOS**
- **Ratings and reviews** for riders and drivers
- **Complaints and admin dashboard**: verification, moderation, suspension and bans

## Platforms (prototype)

| Surface | Users |
|---|---|
| Mobile app | Rider, Driver |
| Web portal | Rider, Driver |
| Admin web panel | Administrators |

## The working app

The prototype is now a real full-stack app: a mobile-first web app (installable as a PWA) backed by a REST API and a SQLite database, with **zero npm dependencies** (Node 22+ only).

<p>
  <img src="docs/screenshots/login.png" width="180" alt="Login">
  <img src="docs/screenshots/find-rides.png" width="180" alt="Find rides">
  <img src="docs/screenshots/ride-details.png" width="180" alt="Ride details">
  <img src="docs/screenshots/admin.png" width="180" alt="Admin dashboard">
</p>

### Run it

```bash
node -v                # needs 22.5 or newer
npm run seed           # optional demo data (students, a driver, rides)
ADMIN_PASSWORD=choose-one npm start
# open http://localhost:3000
```

Demo logins after `npm run seed` (password `password123`): `arif@bscse.uiu.ac.bd` (rider), `rahat@bscse.uiu.ac.bd` (driver). Admin: `admin@uiu.ac.bd` with the `ADMIN_PASSWORD` you set (a random one is printed on first start if you don't).

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port | `3000` |
| `DATA_DIR` | database and session secret | `./data` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | first admin account | `admin@uiu.ac.bd` / random |
| `ALLOWED_EMAIL_DOMAIN` | who may register | `uiu.ac.bd` |
| `SESSION_SECRET` | cookie signing key | generated into `DATA_DIR` |

`npm test` runs 11 API tests (auth, permissions, seat limits, negotiation, payments, ratings, matching, admin).

### What is implemented vs. the SRS

| SRS feature | Status |
|---|---|
| UIU-email registration, login, roles, admin approval | ✅ UIU domain check + student ID + admin verification |
| Driver and bike verification | ✅ bike/licence details reviewed by admin |
| Ride posting, search and filters | ✅ pickup, destination, date, max fare |
| Smart matching from class routine | ✅ saved weekly routine matched on place, weekday and time |
| Booking request, driver approval, seat management | ✅ seats can't be oversold |
| In-app chat and fare negotiation | ✅ offers the other side accepts (polling every 4 s) |
| Payments (bKash, Nagad, cash) | 🟡 **demo mode**: records a fake transaction, cash is confirmed by the driver. Real gateways need merchant credentials |
| Live GPS tracking | 🟡 browser geolocation, shared by the driver, link opens OpenStreetMap |
| Emergency SOS | 🟡 alert with location appears in the admin dashboard; no SMS or push yet |
| Ratings and reviews | ✅ both directions, after a finished ride |
| Complaints and admin dashboard | ✅ verification queues, reports, SOS, ban/suspend |
| Student ID **photo** upload, email OTP, push notifications | ❌ not built yet |

### Architecture

`public/` is a vanilla-JS single-page app (hash routing, strict CSP, no inline scripts). `server/` is a plain Node HTTP server: `app.js` (routes and rules), `db.js` (SQLite schema via `node:sqlite`), `auth.js` (scrypt password hashing, HMAC-signed session cookies, rate limiting). Notable safeguards: parameterised SQL everywhere, transactions for seat allocation, HttpOnly/SameSite cookies, login and sign-up rate limits, banned users cut off immediately.

## Documentation

| Document | Location |
|---|---|
| Software Requirements Specification | [`docs/srs/Campus-Cruise_SRS.pdf`](docs/srs/Campus-Cruise_SRS.pdf) |
| Proposal presentation | [`docs/presentations/Presentation_01_Proposal.pptx`](docs/presentations/Presentation_01_Proposal.pptx) |
| Feasibility and analysis presentation | [`docs/presentations/Presentation_02_F_Analysis.pptx`](docs/presentations/Presentation_02_F_Analysis.pptx) |

The SRS covers requirements elicitation (survey of UIU students, Uber/Pathao benchmarking, MoSCoW prioritisation), 16 functional requirement groups, non-functional requirements, feasibility and SWOT analysis, system diagrams and the prototype design.

## System design

| Data Flow Diagram | Use Case Diagram |
|---|---|
| ![DFD](docs/diagrams/dfd.png) | ![Use case](docs/diagrams/use-case.png) |

| Class Diagram | Ride Booking Sequence |
|---|---|
| ![Class](docs/diagrams/class.png) | ![Sequence](docs/diagrams/sequence.png) |

## UI prototype

Screens from the Figma prototype (section 8 of the SRS).

### Mobile app (rider and driver)

<p>
  <img src="docs/prototype/mobile/01-login.png" width="150" alt="Login" title="Login">
  <img src="docs/prototype/mobile/02-splash.png" width="150" alt="Splash" title="Splash">
  <img src="docs/prototype/mobile/03-choose-role.png" width="150" alt="Choose role" title="Choose role">
  <img src="docs/prototype/mobile/04-find-a-ride.png" width="150" alt="Find a ride" title="Find a ride">
  <img src="docs/prototype/mobile/05-ride-details.png" width="150" alt="Ride details" title="Ride details">
  <img src="docs/prototype/mobile/06-chat-fare-bargain.png" width="150" alt="Chat fare bargain" title="Chat fare bargain">
  <img src="docs/prototype/mobile/07-trip-summary-payment.png" width="150" alt="Trip summary payment" title="Trip summary payment">
  <img src="docs/prototype/mobile/08-ride-confirmed.png" width="150" alt="Ride confirmed" title="Ride confirmed">
  <img src="docs/prototype/mobile/09-live-tracking.png" width="150" alt="Live tracking" title="Live tracking">
  <img src="docs/prototype/mobile/10-rate-trip.png" width="150" alt="Rate trip" title="Rate trip">
  <img src="docs/prototype/mobile/11-driver-home.png" width="150" alt="Driver home" title="Driver home">
  <img src="docs/prototype/mobile/12-driver-post-ride.png" width="150" alt="Driver post ride" title="Driver post ride">
</p>

### Web portals (rider, driver, admin)

**Login**

![Login](docs/prototype/web/01-login.png)

**Select role**

![Select role](docs/prototype/web/02-select-role.png)

**Rider dashboard**

![Rider dashboard](docs/prototype/web/03-rider-dashboard.png)

**Splash**

![Splash](docs/prototype/web/04-splash.png)

**Rider ride details and booking**

![Rider ride details and booking](docs/prototype/web/05-rider-ride-details-and-booking.png)

**Rider payment**

![Rider payment](docs/prototype/web/06-rider-payment.png)

**Rider rating and settings**

![Rider rating and settings](docs/prototype/web/07-rider-rating-and-settings.png)

**Driver dashboard and rides**

![Driver dashboard and rides](docs/prototype/web/08-driver-dashboard-and-rides.png)

**Driver messages and settings**

![Driver messages and settings](docs/prototype/web/09-driver-messages-and-settings.png)

**Admin dashboard and users**

![Admin dashboard and users](docs/prototype/web/10-admin-dashboard-and-users.png)

**Admin verification and reports**

![Admin verification and reports](docs/prototype/web/11-admin-verification-and-reports.png)

🎨 **Figma link:** _add the Figma share link here_

## Team

- Nafis Iqbal Neloy
- Abdullah Al Muhaimin
- Jannatul Ferdous
- Nazifa Akter
- Israt Jahan Sukonna

Submitted to **Sidratul Muntaha**, Lecturer, Dept. of CSE, UIU, on 11 June 2026.
