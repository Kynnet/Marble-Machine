import express from 'express';
import session from 'express-session';
import createSqliteStore from 'better-sqlite3-session-store';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { createRoutes } from './routes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'web', 'dist');

export function createApp({
  dbFile = process.env.DB_FILE || path.join(ROOT, 'marble.db'),
  secret = 'dev-secret',
} = {}) {
  const app = express();
  const stores = openDatabase(dbFile);

  // Hosting platforms terminate TLS at a proxy and forward over plain HTTP.
  // Without this Express sees an insecure request and refuses to set a
  // Secure session cookie, which reads as "login silently does nothing".
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

  app.use(express.json({ limit: '256kb' }));
  // Sessions live in the same SQLite file as everything else, so a restart
  // does not sign everyone out (and the default MemoryStore does not leak).
  const SqliteStore = createSqliteStore(session);

  app.use(
    session({
      name: 'marble.sid',
      secret,
      store: new SqliteStore({
        client: stores.db,
        expired: { clear: true, intervalMs: 15 * 60 * 1000 },
      }),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        // Same-origin app, so Lax is enough to keep the cookie off cross-site posts.
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 24 * 14,
      },
    }),
  );

  app.use('/api', createRoutes(stores));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown endpoint.' }));

  // Hashed bundle filenames never change contents, so they can be cached forever.
  app.use(
    '/static',
    express.static(DIST, {
      index: false,
      setHeaders: (res, file) => {
        if (file.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  // SPA shell for every non-API GET. It names the current asset hashes, so it must
  // never be cached — a stale shell asks for a bundle that no longer exists.
  app.use((req, res, next) => {
    // HEAD as well as GET: health checks and proxies use it, and Express only
    // maps HEAD onto GET for routes registered with app.get().
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    // A missing asset must 404 rather than fall through to the shell. Otherwise
    // a stale cached shell asking for an old hash gets HTML served as
    // JavaScript, which fails with an error that names nothing useful.
    if (req.path.startsWith('/static/')) return next();
    const shell = path.join(DIST, 'index.html');
    if (!fs.existsSync(shell)) {
      return res.status(503).send('Frontend not built. Run `npm run build`, or use `npm run dev`.');
    }
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(shell);
  });

  app.locals.stores = stores;
  return app;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const port = Number(process.env.PORT) || 8000;
  createApp({ secret: process.env.SESSION_SECRET || 'dev-secret' }).listen(port, () => {
    console.log(`Marble Machine API on http://127.0.0.1:${port}`);
  });
}
