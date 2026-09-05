# Marble Machine

A browser-based musical marble machine. You build a board out of planks, bumpers and pads,
drop a marble into it, and the bounces play music. Every piece is tuned to a note and
sounds it when the marble strikes it.

**Live URL:**  https://marble-machine.onrender.com/
---

## What it does

Sign in, and you get a sandbox with a grid of obstacles. Press **Drop marble** and a single
marble falls in and starts bouncing. Each time it hits a piece, that piece plays its note and
flashes white.

The marble never loses energy, so it keeps bouncing indefinitely. 

You can try to make music by editing the board:

- **Move a piece** by dragging it. **Rotate** it by dragging the yellow handle above it, or with
  the rotation slider, or the `[` and `]` keys.
- **Place new pieces** by picking a type from the palette and clicking empty space.
- **Retune any piece** by selecting it and choosing a different note.

All pitches come from a C major pentatonic scale running from C3 up to A5, so any arrangement of
pieces sounds consonant and makes it easier.

Boards can be saved to your account and reload later. Each of the three piece types has its own timbre:

| Piece | Shape | Timbre |
| --- | --- | --- |
| Plank | Rotatable bar | Wood - soft triangle tone |
| Bumper | Circle | Bell - FM synthesis with a long decay |
| Pad | Square | Pluck — short AM-synthesis attack |

---

## Features included

### Frontend
- **Components** — React component tree: `App`, `Board`, `AuthPanel`, `NoteSelect`.
- **Animations** — a 60fps canvas simulation, plus a flash on each struck piece.
- **Mobile responsiveness** — the board is defined in fixed virtual units (1200×800) and scaled to
  fit any container.

### Backend
- **Registration / login / logout** — bcrypt-hashed passwords, `express-session` cookie sessions
  stored in SQLite so a restart does not sign everyone out. The session ID is regenerated on
  sign-in to prevent session fixation, and every request looks the user up rather than trusting the
  cookie's contents, so deleted accounts fail closed.
- **API calls** — a JSON REST API under `/api` (see the table below).
- **Database integration** — SQLite via `better-sqlite3`, with a foreign key from boards to their
  owner and a cascading delete.
- **Classes and objects** — `User`, `Board`, `UserStore`, `BoardStore` on the server;
  `Obstacle` and `MarbleWorld` on the client.

### Full-stack
- **React frontend linked to a Node backend**, served **single-origin**: Express serves both `/api`
  and the built React bundle. No CORS, no cross-site cookie rules, and session auth behaves exactly
  as it would in a plain server-rendered app. 

### API

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Create an account and start a session |
| `POST` | `/api/auth/login` | Sign in |
| `POST` | `/api/auth/logout` | Destroy the session |
| `GET` | `/api/auth/me` | Current user, or `null` |
| `GET` | `/api/boards` | List the signed-in user's boards |
| `POST` | `/api/boards` | Save a board (upserts by name) |
| `GET` | `/api/boards/:id` | Load one board |
| `DELETE` | `/api/boards/:id` | Delete one board |

Board routes are scoped to the signed-in user. Anonymous requests get `401`; another user's board
ID gets `404`.

### Extra features

- **Auto-mute when the tab is hidden**, so a backgrounded tab never plays.
- **Deterministic physics** — the same board replays identically.

---

## Tech stack

| Concern | Choice |
| --- | --- |
| Physics | [matter.js](https://brm.io/matter-js/) |
| Audio | [Tone.js](https://tonejs.github.io/) |
| Frontend | React 19 + Vite |
| Backend | Express 5, `express-session`, `bcryptjs` |
| Database | SQLite (`better-sqlite3`) |
| Tests | Vitest + Supertest |

---

## Time spent

Roughly **7 hours**.

---

### Configuring a service created by hand

A service created through **New → Web Service** ignores `render.yaml`, so its defaults have to be
replaced. Render's defaults build only the backend and start the wrong file:

| Setting | Must be |
| --- | --- |
| Build Command | `./build.sh` |
| Start Command | `npm start` |
| Health Check Path | `/api/auth/me` |

Then add the [environment variables](#environment-variables) below and mount a disk at `/data`.
The build command matters as much as the start command: the default `npm install` never builds the
frontend, so the server comes up with no `web/dist` and answers every page with
`503 Frontend not built`.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Set to `production` to enable secure cookies and proxy trust |
| `SESSION_SECRET` | Signs session cookies. Changing it signs everyone out |
| `DB_FILE` | Path to the SQLite file. Must be inside the mounted disk |
| `PORT` | Defaults to `8000`; Render sets this automatically |

---

## Running the project locally

### Prerequisites

- **Node.js 22.12 or newer** (developed on Node 24)

### 1. Install

```bash
git clone <https://github.com/Kynnet/Marble-Machine>
cd Marble-Machine
npm install
```

### 2. Run

```bash
npm run dev
```

This starts both servers at once:

- the API on `http://127.0.0.1:8000`
- the Vite dev server on `http://localhost:5173`

**Open `http://localhost:5173`.** Requests to `/api` are proxied to Express, so everything is
same-origin.

### 3. Use it

1. You land on the login screen. Click **Need an account? Register** and create one —
   any username of 3+ characters and password of 6+ characters.
2. Click **Drop marble**. The marble falls in and starts playing the board.
   > Browsers block audio until you interact with the page, so the sound switches on with that
   > first click. If you hear nothing, check the **Mute** button and your system volume.

The database file `marble.db` is created automatically in the project root on first run.

### Running the tests

```bash
npm test
```

### Running the production build

```bash
./build.sh
NODE_ENV=production SESSION_SECRET=<something-random> npm start
```

Express then serves the built bundle and the API together on `http://127.0.0.1:8000`.


---

## Project structure

```
server/
  index.js      Express app, sessions, single-origin static + SPA serving
  db.js         SQLite schema; User, Board, UserStore, BoardStore classes
  routes.js     Auth and board endpoints
web/src/
  App.jsx       Auth gate, control panel, save/load
  Board.jsx     Canvas, render loop, drag and rotate interaction
  engine.js     Obstacle and MarbleWorld classes over matter.js
  audio.js      MarbleSynth over Tone.js
  api.js        Fetch wrapper
```
---