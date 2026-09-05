import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './index.js';

let app;
beforeEach(() => {
  app = createApp({ dbFile: ':memory:', secret: 'test-secret' });
});

const board = { obstacles: [{ id: 'a', kind: 'plank', x: 10, y: 20, angle: 0.5, note: 'C4' }] };

async function signUp(agent, username = 'player', password = 'password1') {
  const response = await agent.post('/api/auth/register').send({ username, password });
  expect(response.status).toBe(200);
  return response;
}

describe('auth', () => {
  it('registers, keeps the session, and logs out', async () => {
    const agent = request.agent(app);
    const registered = await signUp(agent);
    expect(registered.body.user).toMatchObject({ username: 'player' });
    expect(registered.body.user.password_hash).toBeUndefined();

    const me = await agent.get('/api/auth/me');
    expect(me.body.user).toMatchObject({ username: 'player' });

    await agent.post('/api/auth/logout');
    const afterLogout = await agent.get('/api/auth/me');
    expect(afterLogout.body.user).toBe(null);
  });

  it('logs back in with the right password and rejects the wrong one', async () => {
    await signUp(request.agent(app));

    const good = await request(app).post('/api/auth/login').send({ username: 'player', password: 'password1' });
    expect(good.status).toBe(200);

    const bad = await request(app).post('/api/auth/login').send({ username: 'player', password: 'nope' });
    expect(bad.status).toBe(401);
  });

  it('rejects duplicate usernames and weak input', async () => {
    await signUp(request.agent(app));

    const duplicate = await request(app).post('/api/auth/register').send({ username: 'player', password: 'password1' });
    expect(duplicate.status).toBe(400);

    const short = await request(app).post('/api/auth/register').send({ username: 'ab', password: 'password1' });
    expect(short.status).toBe(400);
  });
});

describe('boards', () => {
  it('refuses anonymous access', async () => {
    expect((await request(app).get('/api/boards')).status).toBe(401);
    expect((await request(app).post('/api/boards').send({ name: 'x', data: board })).status).toBe(401);
  });

  it('saves, lists, reloads and deletes a board', async () => {
    const agent = request.agent(app);
    await signUp(agent);

    const saved = await agent.post('/api/boards').send({ name: 'Machine', data: board });
    expect(saved.status).toBe(201);
    const { id } = saved.body.board;

    const listed = await agent.get('/api/boards');
    expect(listed.body.boards).toHaveLength(1);

    const loaded = await agent.get(`/api/boards/${id}`);
    expect(loaded.body.board.data.obstacles[0]).toMatchObject({ note: 'C4', angle: 0.5 });

    expect((await agent.delete(`/api/boards/${id}`)).status).toBe(200);
    expect((await agent.get('/api/boards')).body.boards).toHaveLength(0);
  });

  it('overwrites a board saved again under the same name', async () => {
    const agent = request.agent(app);
    await signUp(agent);

    await agent.post('/api/boards').send({ name: 'Machine', data: board });
    await agent.post('/api/boards').send({ name: 'Machine', data: { obstacles: [] } });

    const listed = await agent.get('/api/boards');
    expect(listed.body.boards).toHaveLength(1);
    const loaded = await agent.get(`/api/boards/${listed.body.boards[0].id}`);
    expect(loaded.body.board.data.obstacles).toHaveLength(0);
  });

  it('does not leak boards between users', async () => {
    const owner = request.agent(app);
    await signUp(owner, 'owner');
    const created = await owner.post('/api/boards').send({ name: 'Private', data: board });

    const other = request.agent(app);
    await signUp(other, 'intruder');
    expect((await other.get('/api/boards')).body.boards).toHaveLength(0);
    expect((await other.get(`/api/boards/${created.body.board.id}`)).status).toBe(404);
  });
});
