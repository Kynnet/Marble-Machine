import { describe, expect, it } from 'vitest';
import { BOARD_H, BOARD_W, FIXED_DT, MarbleWorld, Obstacle, demoBoard } from './engine.js';

const play = (world, seconds) => {
  const hits = [];
  for (let i = 0; i < 120 * seconds; i += 1) {
    world.step(FIXED_DT);
    hits.push(...world.drainHits());
  }
  return hits;
};

describe('Obstacle', () => {
  it('hit-tests a rotated plank in its own frame', () => {
    const plank = new Obstacle({ kind: 'plank', x: 100, y: 100, note: 'C4', angle: Math.PI / 2 });
    // Rotated upright, so it is now tall and narrow rather than wide and flat.
    expect(plank.containsPoint(100, 170)).toBe(true);
    expect(plank.containsPoint(170, 100)).toBe(false);
  });

  it('hit-tests a bumper by radius', () => {
    const bumper = new Obstacle({ kind: 'bumper', x: 100, y: 100, note: 'C4' });
    expect(bumper.containsPoint(120, 100)).toBe(true);
    expect(bumper.containsPoint(140, 100)).toBe(false);
  });
});

describe('MarbleWorld editing', () => {
  it('moves and rotates an obstacle, clamped to the board', () => {
    const world = new MarbleWorld(demoBoard());
    const [first] = [...world.obstacles.values()];

    world.updateObstacle(first.id, { x: 400, y: 300, angle: 1.2 });
    expect(world.obstacles.get(first.id)).toMatchObject({ x: 400, y: 300, angle: 1.2 });
    expect(world.bodies.get(first.id).position).toMatchObject({ x: 400, y: 300 });

    world.updateObstacle(first.id, { x: BOARD_W + 500, y: -200 });
    expect(world.obstacles.get(first.id)).toMatchObject({ x: BOARD_W, y: 0 });
  });

  it('adds and removes bodies to match the obstacle list', () => {
    const board = demoBoard();
    const world = new MarbleWorld(board);
    expect(world.bodies.size).toBe(board.length);

    world.setObstacles(board.slice(0, 3));
    expect(world.bodies.size).toBe(3);
    expect(world.obstacles.size).toBe(3);
  });

  it('picks the obstacle under a point', () => {
    const world = new MarbleWorld([
      new Obstacle({ id: 'a', kind: 'bumper', x: 300, y: 300, note: 'C4' }).toJSON(),
    ]);
    expect(world.pick(300, 300)).toBe('a');
    expect(world.pick(900, 700)).toBe(null);
  });
});

describe('the marble', () => {
  it('reports the struck obstacle note and timbre', () => {
    const world = new MarbleWorld([
      new Obstacle({ id: 'target', kind: 'pad', x: 600, y: 400, note: 'G4' }).toJSON(),
    ]);
    world.drop(600, 60);
    const hits = play(world, 5);

    const first = hits.find((hit) => hit.id === 'target');
    expect(first).toBeDefined();
    expect(first.note).toBe('G4');
    expect(first.timbre).toBe('pluck');
  });

  it('stays inside the sandbox rather than tunnelling out', () => {
    const world = new MarbleWorld(demoBoard());
    world.drop(BOARD_W / 2, 60);
    for (let i = 0; i < 120 * 60; i += 1) {
      world.step(FIXED_DT);
      world.drainHits();
      const { x, y } = world.marbleState();
      expect(x).toBeGreaterThan(-20);
      expect(x).toBeLessThan(BOARD_W + 20);
      expect(y).toBeGreaterThan(-20);
      expect(y).toBeLessThan(BOARD_H + 20);
    }
  });

  // The regression that matters: a marble that settles into rolling along the
  // floor keeps moving but stops making music, which looks fine and sounds dead.
  it('keeps playing instead of settling into rolling contact', () => {
    const world = new MarbleWorld(demoBoard());
    world.drop(BOARD_W / 2, 60);
    play(world, 60); // let it reach whatever steady state it is going to reach

    const lateHits = play(world, 60);
    expect(lateHits.length).toBeGreaterThan(30);
    expect(new Set(lateHits.map((hit) => hit.note)).size).toBeGreaterThan(3);
  });

  it('is deterministic, so a saved board replays identically', () => {
    const board = demoBoard();
    const transcript = () => {
      const world = new MarbleWorld(board);
      world.drop(BOARD_W / 2, 60);
      return play(world, 20).map((hit) => `${hit.id}@${hit.note}`);
    };
    const first = transcript();
    expect(first.length).toBeGreaterThan(0);
    expect(transcript()).toEqual(first);
  });
});
