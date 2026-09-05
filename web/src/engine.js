import Matter from 'matter-js';

export const BOARD_W = 1200;
export const BOARD_H = 800;
export const FIXED_DT = 1 / 120;
export const MAX_CATCH_UP = 0.05; // ~3 frames at 60Hz; see realtime-canvas-react
export const MARBLE_RADIUS = 13;

// Matter velocity is px per 16.667ms, so 11 here is roughly 660 px/s.
export const MARBLE_SPEED = 11;

/**
 * Minimum share of the marble's speed that must point away from whatever it
 * just touched. Without this the marble settles into rolling contact along the
 * floor — vertical velocity bleeds away over repeated low bounces, and it slides
 * back and forth forever without ever reaching an obstacle again.
 */
const MIN_BOUNCE_FRACTION = 0.55;

/** Two octaves of C major pentatonic — any combination of these sounds consonant. */
export const PENTATONIC = [
  'C3', 'D3', 'F3', 'G3', 'A3',
  'C4', 'D4', 'F4', 'G4', 'A4',
  'C5', 'D5', 'F5', 'G5', 'A5',
];

export const KINDS = {
  plank: { label: 'Plank', timbre: 'wood', width: 170, height: 18, color: '#c98b52' },
  bumper: { label: 'Bumper', timbre: 'bell', radius: 34, color: '#7ec8e3' },
  pad: { label: 'Pad', timbre: 'pluck', width: 78, height: 78, color: '#b48ce0' },
};

let nextId = 0;
export const newObstacleId = () => `o${Date.now().toString(36)}${(nextId++).toString(36)}`;

export class Obstacle {
  constructor({ id, kind, x, y, angle = 0, note }) {
    this.id = id ?? newObstacleId();
    this.kind = kind in KINDS ? kind : 'plank';
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.note = note ?? 'C4';
  }

  get spec() {
    return KINDS[this.kind];
  }

  get timbre() {
    return this.spec.timbre;
  }

  toJSON() {
    return { id: this.id, kind: this.kind, x: this.x, y: this.y, angle: this.angle, note: this.note };
  }

  /** Half-extents of the bounding box, used for hit testing and for drawing handles. */
  get halfSize() {
    const { radius, width, height } = this.spec;
    return radius ? { x: radius, y: radius } : { x: width / 2, y: height / 2 };
  }

  containsPoint(px, py) {
    const dx = px - this.x;
    const dy = py - this.y;
    if (this.spec.radius) return Math.hypot(dx, dy) <= this.spec.radius;
    // Rotate the point into the obstacle's local frame, then compare against half-extents.
    const cos = Math.cos(-this.angle);
    const sin = Math.sin(-this.angle);
    const half = this.halfSize;
    return Math.abs(dx * cos - dy * sin) <= half.x && Math.abs(dx * sin + dy * cos) <= half.y;
  }

  createBody() {
    const options = {
      isStatic: true,
      restitution: 1,
      friction: 0,
      frictionStatic: 0,
      angle: this.angle,
      plugin: { obstacleId: this.id },
    };
    const { radius, width, height } = this.spec;
    return radius
      ? Matter.Bodies.circle(this.x, this.y, radius, options)
      : Matter.Bodies.rectangle(this.x, this.y, width, height, options);
  }
}

/**
 * Owns the whole simulation. Deliberately free of React so it can be stepped
 * headlessly in tests and driven from a rAF loop in the component.
 */
export class MarbleWorld {
  constructor(obstacles = []) {
    this.engine = Matter.Engine.create({ gravity: { x: 0, y: 1, scale: 0.0012 } });
    this.bodies = new Map();
    this.obstacles = new Map();
    this.hits = [];
    this.marble = null;
    this.contactNormal = null;
    this.#addWalls();
    Matter.Events.on(this.engine, 'collisionStart', (event) => this.#recordHits(event));
    this.setObstacles(obstacles);
  }

  #addWalls() {
    const t = 60;
    const wall = (x, y, w, h) =>
      Matter.Bodies.rectangle(x, y, w, h, { isStatic: true, restitution: 1, friction: 0 });
    Matter.Composite.add(this.engine.world, [
      wall(BOARD_W / 2, -t / 2, BOARD_W + t * 2, t),
      wall(BOARD_W / 2, BOARD_H + t / 2, BOARD_W + t * 2, t),
      wall(-t / 2, BOARD_H / 2, t, BOARD_H + t * 2),
      wall(BOARD_W + t / 2, BOARD_H / 2, t, BOARD_H + t * 2),
    ]);
  }

  #recordHits({ pairs }) {
    if (!this.marble) return;
    for (const pair of pairs) {
      const { bodyA, bodyB } = pair;
      if (bodyA !== this.marble && bodyB !== this.marble) continue;
      // Matter's normal points from bodyA to bodyB; flip it to point at the marble.
      const sign = bodyB === this.marble ? 1 : -1;
      this.contactNormal = {
        x: pair.collision.normal.x * sign,
        y: pair.collision.normal.y * sign,
      };
      const other = bodyA === this.marble ? bodyB : bodyA;
      const obstacle = this.obstacles.get(other.plugin?.obstacleId);
      if (!obstacle) continue; // a wall: bounces, but stays silent
      this.hits.push({
        id: obstacle.id,
        note: obstacle.note,
        timbre: obstacle.timbre,
        speed: Matter.Body.getSpeed(this.marble),
      });
    }
  }

  /**
   * Reconciles the physics world with the React-owned obstacle list. Existing
   * bodies are moved rather than rebuilt, so dragging one does not disturb the marble.
   */
  setObstacles(specs) {
    const seen = new Set();
    for (const spec of specs) {
      const obstacle = spec instanceof Obstacle ? spec : new Obstacle(spec);
      seen.add(obstacle.id);
      this.obstacles.set(obstacle.id, obstacle);
      const body = this.bodies.get(obstacle.id);
      if (body) {
        Matter.Body.setPosition(body, { x: obstacle.x, y: obstacle.y });
        Matter.Body.setAngle(body, obstacle.angle);
      } else {
        const created = obstacle.createBody();
        this.bodies.set(obstacle.id, created);
        Matter.Composite.add(this.engine.world, created);
      }
    }
    for (const id of [...this.bodies.keys()]) {
      if (seen.has(id)) continue;
      Matter.Composite.remove(this.engine.world, this.bodies.get(id));
      this.bodies.delete(id);
      this.obstacles.delete(id);
    }
  }

  /** Applies a live edit (drag or rotate) to both the model and its body. */
  updateObstacle(id, patch) {
    const obstacle = this.obstacles.get(id);
    if (!obstacle) return null;
    if (patch.x !== undefined) obstacle.x = Math.min(BOARD_W, Math.max(0, patch.x));
    if (patch.y !== undefined) obstacle.y = Math.min(BOARD_H, Math.max(0, patch.y));
    if (patch.angle !== undefined) obstacle.angle = patch.angle;
    const body = this.bodies.get(id);
    if (body) {
      Matter.Body.setPosition(body, { x: obstacle.x, y: obstacle.y });
      Matter.Body.setAngle(body, obstacle.angle);
    }
    return obstacle;
  }

  /** Only ever one marble in play; dropping again replaces it. */
  drop(x = BOARD_W / 2, y = 60) {
    this.clearMarble();
    this.marble = Matter.Bodies.circle(x, y, MARBLE_RADIUS, {
      restitution: 1,
      friction: 0,
      frictionAir: 0,
      frictionStatic: 0,
      label: 'marble',
    });
    Matter.Composite.add(this.engine.world, this.marble);
    return this.marble;
  }

  clearMarble() {
    if (this.marble) Matter.Composite.remove(this.engine.world, this.marble);
    this.marble = null;
    this.contactNormal = null;
    this.hits.length = 0;
  }

  step(dt = FIXED_DT) {
    this.contactNormal = null;
    Matter.Engine.update(this.engine, dt * 1000);
    if (this.marble && this.contactNormal) this.#restoreBounce();
  }

  /**
   * Runs on every contact. Gravity shapes the arc between bounces, but the
   * marble leaves each one at a constant speed and with a guaranteed outward
   * component, so it never loses energy and never settles into rolling.
   */
  #restoreBounce() {
    const normal = this.contactNormal;
    const velocity = Matter.Body.getVelocity(this.marble);
    const speed = Math.max(Math.hypot(velocity.x, velocity.y), MARBLE_SPEED);
    const along = velocity.x * normal.x + velocity.y * normal.y;
    const wanted = speed * MIN_BOUNCE_FRACTION;

    let next = velocity;
    if (along < wanted) {
      const push = wanted - along;
      next = { x: velocity.x + push * normal.x, y: velocity.y + push * normal.y };
    }
    const scale = speed / Math.hypot(next.x, next.y);
    Matter.Body.setVelocity(this.marble, { x: next.x * scale, y: next.y * scale });
  }

  drainHits() {
    const hits = this.hits;
    this.hits = [];
    return hits;
  }

  marbleState() {
    if (!this.marble) return null;
    return { x: this.marble.position.x, y: this.marble.position.y, r: MARBLE_RADIUS };
  }

  /** Topmost obstacle under a point, so recently placed pieces win a stacked hit. */
  pick(x, y) {
    const all = [...this.obstacles.values()];
    for (let i = all.length - 1; i >= 0; i -= 1) {
      if (all[i].containsPoint(x, y)) return all[i].id;
    }
    return null;
  }
}

/**
 * The starting layout. Four staggered rows keep the marble in obstacle territory
 * instead of drifting into the empty strip above the floor, which is what makes
 * the difference between a steady melody and a few lonely notes.
 */
export function demoBoard() {
  const notes = ['C4', 'D4', 'F4', 'G4', 'A4', 'C5', 'G3', 'A3', 'F3', 'D5'];
  const board = [];
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      const kind = row % 2 === 0 ? 'plank' : column % 2 === 0 ? 'bumper' : 'pad';
      board.push(
        new Obstacle({
          kind,
          x: 150 + column * 225 + (row % 2) * 110,
          y: 190 + row * 165,
          note: notes[board.length % notes.length],
          angle: row % 2 === 0 ? (column % 2 ? 0.3 : -0.3) : 0,
        }).toJSON(),
      );
    }
  }
  return board;
}
