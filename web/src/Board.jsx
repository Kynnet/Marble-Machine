import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { BOARD_H, BOARD_W, FIXED_DT, KINDS, MAX_CATCH_UP, MarbleWorld } from './engine.js';
import { synth } from './audio.js';

const HANDLE_OFFSET = 34;
const HANDLE_RADIUS = 13;
// How long a struck piece holds its hit colour. Long enough to read as a flash,
// short enough that it is over before the next hit lands.
const FLASH_MS = 120;
const HIT_COLOR = '#ffffff';

const capture = (el, id) => {
  try {
    el.setPointerCapture(id);
  } catch {
    /* pointer already gone; capture is advisory */
  }
};

/**
 * The canvas half of the app. The simulation lives in a ref and never passes
 * through React state, so a 120Hz physics loop costs zero re-renders.
 */
const Board = forwardRef(function Board(
  { obstacles, tool, selectedId, playing, onSelect, onPlace, onCommit },
  handle,
) {
  const canvasRef = useRef(null);
  const worldRef = useRef(null);
  if (!worldRef.current) worldRef.current = new MarbleWorld(obstacles);

  const dragRef = useRef(null);
  const flashRef = useRef(new Map());
  // The loop reads props through a ref so it never needs tearing down.
  const latest = useRef({ tool, selectedId, playing, onSelect, onPlace, onCommit });
  useEffect(() => {
    latest.current = { tool, selectedId, playing, onSelect, onPlace, onCommit };
  });

  useEffect(() => {
    worldRef.current.setObstacles(obstacles);
  }, [obstacles]);

  useImperativeHandle(
    handle,
    () => ({
      drop: () => worldRef.current.drop(BOARD_W / 2, 60),
      reset: () => {
        worldRef.current.clearMarble();
        synth.silence();
      },
    }),
    [],
  );

  // Pause everything when the tab is hidden: rAF stops on its own, but scheduled
  // notes and the reverb tail do not.
  useEffect(() => {
    const onHidden = () => document.hidden && synth.stop();
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, []);

  useEffect(() => {
    if (!playing) synth.stop();
  }, [playing]);

  // --- render + physics loop -------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let frame = 0;
    let previous = performance.now();
    let accumulator = 0;
    let view = { scale: 1, offsetX: 0, offsetY: 0 };

    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const scale = Math.min(rect.width / BOARD_W, rect.height / BOARD_H);
      view = {
        scale,
        offsetX: (rect.width - BOARD_W * scale) / 2,
        offsetY: (rect.height - BOARD_H * scale) / 2,
        dpr,
      };
      canvas.__view = view;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas.parentElement);

    const tick = (now) => {
      frame = requestAnimationFrame(tick);
      const world = worldRef.current;
      const elapsed = Math.min((now - previous) / 1000, MAX_CATCH_UP);
      previous = now;

      if (latest.current.playing) {
        accumulator += elapsed;
        while (accumulator >= FIXED_DT) {
          world.step(FIXED_DT);
          accumulator -= FIXED_DT;
        }
        const hits = world.drainHits();
        synth.playAll(hits);
        for (const hit of hits) flashRef.current.set(hit.id, now + FLASH_MS);
      } else {
        accumulator = 0;
        world.drainHits();
      }

      for (const [id, until] of flashRef.current) {
        if (until <= now) flashRef.current.delete(id);
      }

      draw(ctx, world, view, latest.current.selectedId, flashRef.current);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  // --- pointer interaction ---------------------------------------------------
  const toBoard = (event) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const { scale, offsetX, offsetY } = canvas.__view;
    return {
      x: (event.clientX - rect.left - offsetX) / scale,
      y: (event.clientY - rect.top - offsetY) / scale,
    };
  };

  const handlePosition = (obstacle) => ({
    x: obstacle.x + Math.sin(obstacle.angle) * (obstacle.halfSize.y + HANDLE_OFFSET),
    y: obstacle.y - Math.cos(obstacle.angle) * (obstacle.halfSize.y + HANDLE_OFFSET),
  });

  const onPointerDown = (event) => {
    const world = worldRef.current;
    const point = toBoard(event);
    capture(event.currentTarget, event.pointerId);

    const selected = world.obstacles.get(latest.current.selectedId);
    if (selected) {
      const grip = handlePosition(selected);
      if (Math.hypot(point.x - grip.x, point.y - grip.y) <= HANDLE_RADIUS * 1.6) {
        dragRef.current = { id: selected.id, mode: 'rotate' };
        return;
      }
    }

    const hitId = world.pick(point.x, point.y);
    if (hitId) {
      const obstacle = world.obstacles.get(hitId);
      dragRef.current = { id: hitId, mode: 'move', dx: obstacle.x - point.x, dy: obstacle.y - point.y };
      latest.current.onSelect(hitId);
      return;
    }

    if (latest.current.tool) latest.current.onPlace(latest.current.tool, point.x, point.y);
    else latest.current.onSelect(null);
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = toBoard(event);
    const world = worldRef.current;
    if (drag.mode === 'move') {
      world.updateObstacle(drag.id, { x: point.x + drag.dx, y: point.y + drag.dy });
    } else {
      const obstacle = world.obstacles.get(drag.id);
      if (obstacle) {
        world.updateObstacle(drag.id, {
          angle: Math.atan2(point.y - obstacle.y, point.x - obstacle.x) + Math.PI / 2,
        });
      }
    }
  };

  // Read the draft and clear it before releasing capture: releasePointerCapture
  // can throw, and a throw here would silently discard the user's finished drag.
  const onPointerUp = (event) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag) {
      const obstacle = worldRef.current.obstacles.get(drag.id);
      if (obstacle) onCommit(drag.id, { x: obstacle.x, y: obstacle.y, angle: obstacle.angle });
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  };

  return (
    <div className="board">
      <canvas
        ref={canvasRef}
        className="board__canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  );
});

function draw(ctx, world, view, selectedId, flashes) {
  const { scale, offsetX, offsetY, dpr } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  ctx.fillStyle = '#12131c';
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);
  ctx.strokeStyle = '#1e2030';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= BOARD_W; x += 100) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, BOARD_H);
  }
  for (let y = 0; y <= BOARD_H; y += 100) {
    ctx.moveTo(0, y);
    ctx.lineTo(BOARD_W, y);
  }
  ctx.stroke();

  ctx.font = 'bold 15px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const obstacle of world.obstacles.values()) {
    const spec = KINDS[obstacle.kind];
    const half = obstacle.halfSize;
    ctx.save();
    ctx.translate(obstacle.x, obstacle.y);
    ctx.rotate(obstacle.angle);

    // A struck piece swaps to a single flat colour, with no fade in or out.
    ctx.fillStyle = flashes.has(obstacle.id) ? HIT_COLOR : spec.color;
    ctx.beginPath();
    if (spec.radius) ctx.arc(0, 0, spec.radius, 0, Math.PI * 2);
    else ctx.rect(-half.x, -half.y, half.x * 2, half.y * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(10,10,18,0.85)';
    ctx.fillText(obstacle.note, 0, 0);

    if (obstacle.id === selectedId) {
      ctx.strokeStyle = '#f5f56b';
      ctx.fillStyle = '#f5f56b';
      ctx.lineWidth = 2;
      ctx.strokeRect(-half.x - 6, -half.y - 6, half.x * 2 + 12, half.y * 2 + 12);
      ctx.beginPath();
      ctx.moveTo(0, -half.y - 6);
      ctx.lineTo(0, -half.y - HANDLE_OFFSET);
      ctx.stroke();
      ctx.fillRect(-HANDLE_RADIUS, -half.y - HANDLE_OFFSET - HANDLE_RADIUS, HANDLE_RADIUS * 2, HANDLE_RADIUS * 2);
    }
    ctx.restore();
  }

  const marble = world.marbleState();
  if (marble) {
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath();
    ctx.arc(marble.x, marble.y, marble.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export default Board;
