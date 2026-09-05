import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS boards (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    data       TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, name)
  );
`;

/** Rejected input the caller can fix, as opposed to a server fault. */
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

export class User {
  constructor(row) {
    this.id = row.id;
    this.username = row.username;
    this.createdAt = row.created_at;
  }

  toJSON() {
    return { id: this.id, username: this.username };
  }
}

export class Board {
  constructor(row) {
    this.id = row.id;
    this.name = row.name;
    this.updatedAt = row.updated_at;
    this.data = JSON.parse(row.data);
  }

  toJSON() {
    return { id: this.id, name: this.name, updatedAt: this.updatedAt, data: this.data };
  }

  summary() {
    return { id: this.id, name: this.name, updatedAt: this.updatedAt };
  }
}

export class UserStore {
  constructor(db) {
    this.db = db;
  }

  register(username, password) {
    const name = String(username ?? '').trim();
    if (name.length < 3) throw new ValidationError('Username must be at least 3 characters.');
    if (String(password ?? '').length < 6) throw new ValidationError('Password must be at least 6 characters.');
    if (this.findByUsername(name)) throw new ValidationError('That username is already taken.');

    const hash = bcrypt.hashSync(String(password), 10);
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run(name, hash, new Date().toISOString());
    return this.findById(lastInsertRowid);
  }

  authenticate(username, password) {
    const row = this.db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(String(username ?? '').trim());
    if (!row || !bcrypt.compareSync(String(password ?? ''), row.password_hash)) return null;
    return new User(row);
  }

  findById(id) {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    return row ? new User(row) : null;
  }

  findByUsername(username) {
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    return row ? new User(row) : null;
  }
}

export class BoardStore {
  constructor(db) {
    this.db = db;
  }

  list(userId) {
    return this.db
      .prepare('SELECT * FROM boards WHERE user_id = ? ORDER BY updated_at DESC')
      .all(userId)
      .map((row) => new Board(row));
  }

  get(userId, id) {
    const row = this.db.prepare('SELECT * FROM boards WHERE user_id = ? AND id = ?').get(userId, id);
    return row ? new Board(row) : null;
  }

  /** Upsert by name, so re-saving a board the user already has overwrites it. */
  save(userId, name, data) {
    const title = String(name ?? '').trim();
    if (!title) throw new ValidationError('A board needs a name.');
    if (!data || !Array.isArray(data.obstacles)) throw new ValidationError('Board data is malformed.');

    this.db
      .prepare(
        `INSERT INTO boards (user_id, name, data, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(userId, title, JSON.stringify(data), new Date().toISOString());

    // Read back by name rather than lastInsertRowid, which is meaningless on the update path.
    return new Board(
      this.db.prepare('SELECT * FROM boards WHERE user_id = ? AND name = ?').get(userId, title),
    );
  }

  remove(userId, id) {
    return this.db.prepare('DELETE FROM boards WHERE user_id = ? AND id = ?').run(userId, id).changes > 0;
  }
}

export function openDatabase(file = 'marble.db') {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return { db, users: new UserStore(db), boards: new BoardStore(db) };
}
