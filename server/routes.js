import { Router } from 'express';
import { ValidationError } from './db.js';

/** Turns a thrown ValidationError into a 400 and anything else into a 500. */
const handle = (fn) => (req, res) => {
  try {
    fn(req, res);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
};

export function createRoutes({ users, boards }) {
  const router = Router();

  const requireAuth = (req, res, next) => {
    const user = req.session.userId ? users.findById(req.session.userId) : null;
    if (!user) return res.status(401).json({ error: 'Please sign in first.' });
    req.user = user;
    next();
  };

  // Regenerating the session id on sign-in prevents session fixation.
  const startSession = (req, user, res) =>
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Could not start a session.' });
      req.session.userId = user.id;
      res.json({ user: user.toJSON() });
    });

  router.post(
    '/auth/register',
    handle((req, res) => {
      const user = users.register(req.body?.username, req.body?.password);
      startSession(req, user, res);
    }),
  );

  router.post(
    '/auth/login',
    handle((req, res) => {
      const user = users.authenticate(req.body?.username, req.body?.password);
      if (!user) return res.status(401).json({ error: 'Wrong username or password.' });
      startSession(req, user, res);
    }),
  );

  router.post('/auth/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('marble.sid');
      res.json({ user: null });
    });
  });

  router.get(
    '/auth/me',
    handle((req, res) => {
      const user = req.session.userId ? users.findById(req.session.userId) : null;
      res.json({ user: user ? user.toJSON() : null });
    }),
  );

  router.get(
    '/boards',
    requireAuth,
    handle((req, res) => {
      res.json({ boards: boards.list(req.user.id).map((board) => board.summary()) });
    }),
  );

  router.post(
    '/boards',
    requireAuth,
    handle((req, res) => {
      const board = boards.save(req.user.id, req.body?.name, req.body?.data);
      res.status(201).json({ board: board.toJSON() });
    }),
  );

  router.get(
    '/boards/:id',
    requireAuth,
    handle((req, res) => {
      const board = boards.get(req.user.id, Number(req.params.id));
      if (!board) return res.status(404).json({ error: 'No such board.' });
      res.json({ board: board.toJSON() });
    }),
  );

  router.delete(
    '/boards/:id',
    requireAuth,
    handle((req, res) => {
      if (!boards.remove(req.user.id, Number(req.params.id))) {
        return res.status(404).json({ error: 'No such board.' });
      }
      res.json({ ok: true });
    }),
  );

  return router;
}
