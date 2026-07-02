/* Deterministic DVD-bounce simulation, shared verbatim by the browser (render)
 * and the serverless functions (verification). Given the same settings
 * (seed, epochMs, oddsN, speed, logoW, force) both sides step the exact same
 * trajectory, so the server can check that a reported corner hit really
 * happened before spending SOL.
 *
 * Determinism rules: IEEE-754 arithmetic and Math.sqrt only (correctly
 * rounded everywhere); no Math.hypot/trig (implementation-defined precision);
 * all randomness from the seeded PRNG, consumed in a fixed order per bounce.
 */

export const ARENA_W = 1600;
export const ARENA_H = 900;

// Slack for "both walls at once". Aimed corners land with ~1e-6 units of
// float error, so this can be tiny — keeping natural (unrigged) corners rare
// enough that the odds slider stays the only thing that matters.
const CORNER_EPS = 0.01;
const RATIO_MIN = 0.15;   // aim feasibility bounds (keeps angles sane)
const RATIO_MAX = 6.5;
const MAX_EVENTS = 500000;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Effective 1-in-N odds at an absolute wall-clock time. Interpolates
 * linearly in probability space from oddsN to oddsEndN across decayHours,
 * anchored at decayStartMs — launch hot, cool off on schedule. Uses only
 * IEEE-exact ops (+,-,*,/) so every JS engine computes the same value.
 */
export function oddsAt(settings, absTimeMs) {
  const start = Math.max(1, settings.oddsN);
  const end = Math.max(1, settings.oddsEndN || settings.oddsN);
  const hours = settings.decayHours || 0;
  if (hours <= 0 || end === start) return start;
  const t0 = settings.decayStartMs || settings.epochMs;
  let frac = (absTimeMs - t0) / (hours * 3600000);
  if (frac < 0) frac = 0;
  if (frac > 1) frac = 1;
  const p = 1 / start + frac * (1 / end - 1 / start);
  return 1 / p;
}

export function createSim(settings) {
  const speed = settings.speed;
  const w = settings.logoW;
  const h = Math.round(w / 2);
  const maxX = Math.max(1, ARENA_W - w);
  const maxY = Math.max(1, ARENA_H - h);
  const rng = mulberry32(settings.seed >>> 0);

  // Starting state: either carried over from the previous run (so settings
  // changes don't teleport the logo) or PRNG-derived for a fresh boot.
  let x, y, vx, vy;
  if (Number.isFinite(settings.startX) && Number.isFinite(settings.startY)) {
    x = Math.min(Math.max(settings.startX, 0), maxX);
    y = Math.min(Math.max(settings.startY, 0), maxY);
    vx = Number.isFinite(settings.startVx) ? settings.startVx : 1;
    vy = Number.isFinite(settings.startVy) ? settings.startVy : 0.83;
    if (vx === 0 && vy === 0) { vx = 1; vy = 0.83; }
  } else {
    x = rng() * maxX;
    y = rng() * maxY;
    vx = rng() < 0.5 ? -1 : 1;
    vy = (rng() < 0.5 ? -1 : 1) * 0.83;
  }
  let t = 0; // seconds since epoch; state (x,y) is the position at time t
  let armed = false;
  let bounceCount = 0;
  let cornerCount = 0;
  const corners = []; // { index, time } — capped, most recent kept

  function renorm() {
    const mag = Math.sqrt(vx * vx + vy * vy) || 1;
    vx = (vx / mag) * speed;
    vy = (vy / mag) * speed;
  }
  renorm();

  function aim(adjustY) {
    if (adjustY) {
      const distX = vx > 0 ? maxX - x : x;
      const distY = vy > 0 ? maxY - y : y;
      if (distX <= 0 || distY <= 0) return;
      const needed = distY / (distX / Math.abs(vx));
      const ratio = needed / (Math.abs(vy) || 1e-9);
      if (ratio < RATIO_MIN || ratio > RATIO_MAX) return;
      vy = (vy < 0 ? -1 : 1) * needed;
    } else {
      const distY = vy > 0 ? maxY - y : y;
      const distX = vx > 0 ? maxX - x : x;
      if (distX <= 0 || distY <= 0) return;
      const needed = distX / (distY / Math.abs(vy));
      const ratio = needed / (Math.abs(vx) || 1e-9);
      if (ratio < RATIO_MIN || ratio > RATIO_MAX) return;
      vx = (vx < 0 ? -1 : 1) * needed;
    }
    renorm();
  }

  // Advance to the next wall contact. Returns the event, or null if velocity
  // is degenerate (cannot happen with renorm, but belt and braces).
  function stepEvent() {
    const txw = vx > 0 ? (maxX - x) / vx : vx < 0 ? -x / vx : Infinity;
    const tyw = vy > 0 ? (maxY - y) / vy : vy < 0 ? -y / vy : Infinity;
    const dt = Math.min(txw, tyw);
    if (!isFinite(dt)) return null;

    const slack = CORNER_EPS / Math.max(Math.abs(vx), Math.abs(vy));
    const bx = txw <= tyw + slack;
    const by = tyw <= txw + slack;

    t += dt;
    x += vx * dt;
    y += vy * dt;

    if (bx) {
      x = vx > 0 ? maxX : 0;
      vx = -vx;
    }
    if (by) {
      y = vy > 0 ? maxY : 0;
      vy = -vy;
    }
    bounceCount++;

    const isCorner = bx && by;
    if (isCorner) {
      // Snap visually into the corner for the render side.
      x = vx > 0 ? 0 : maxX;
      y = vy > 0 ? 0 : maxY;
      cornerCount++;
      corners.push({ index: cornerCount - 1, time: t });
      if (corners.length > 64) corners.shift();
      armed = false;
      // Break the exact-retrace symmetry (fixed rng order: 2 calls).
      vx *= 1 + (rng() - 0.5) * 0.3;
      vy *= 1 + (rng() - 0.5) * 0.3;
      renorm();
    }

    // Arming roll — exactly 1 rng call per bounce, corner or not.
    const roll = rng();
    const pNow = 1 / oddsAt(settings, settings.epochMs + t * 1000);
    if (!armed && (roll < pNow || (settings.force && bounceCount === 1))) {
      armed = true;
    }
    if (armed) aim(isCorner || bx);

    return { time: t, bx, by, isCorner };
  }

  return {
    // Process all events up to tTarget (seconds since epoch).
    advanceTo(tTarget) {
      let iter = 0;
      while (iter++ < MAX_EVENTS) {
        // Peek at the next event time without committing.
        const txw = vx > 0 ? (maxX - x) / vx : vx < 0 ? -x / vx : Infinity;
        const tyw = vy > 0 ? (maxY - y) / vy : vy < 0 ? -y / vy : Infinity;
        const dt = Math.min(txw, tyw);
        if (!isFinite(dt) || t + dt > tTarget) break;
        if (!stepEvent()) break;
      }
    },
    positionAt(tNow) {
      const dt = Math.max(0, tNow - t);
      return { x: x + vx * dt, y: y + vy * dt, w, h };
    },
    // Instantaneous kinematic state — used to carry the logo seamlessly into
    // a new run when settings change.
    stateAt(tNow) {
      const dt = Math.max(0, tNow - t);
      return { x: x + vx * dt, y: y + vy * dt, vx, vy };
    },
    get corners() {
      return corners;
    },
    get bounceCount() {
      return bounceCount;
    },
    get cornerCount() {
      return cornerCount;
    },
    get colorIndex() {
      return bounceCount;
    },
  };
}

// Shared settings hygiene — the server clamps on write, the client on read.
export function clampSettings(s) {
  const n = (v, lo, hi, d) => {
    const x = Math.round(Number(v));
    return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
  };
  const f = (v, lo, hi, d) => {
    const x = Number(v);
    return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
  };
  // Optional carry-over floats: null when absent, exact value when present.
  const maybe = (v) => {
    if (v === null || v === undefined) return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const oddsN = n(s.oddsN, 1, 1000000, 100);
  return {
    version: n(s.version, 1, Number.MAX_SAFE_INTEGER, 1),
    seed: n(s.seed, 0, 4294967295, 1),
    epochMs: n(s.epochMs, 0, Number.MAX_SAFE_INTEGER, 0),
    oddsN,
    oddsEndN: n(s.oddsEndN, 1, 1000000, oddsN),
    decayHours: f(s.decayHours, 0, 720, 0),
    decayStartMs: n(s.decayStartMs, 0, Number.MAX_SAFE_INTEGER, 0),
    speed: n(s.speed, 60, 1200, 320),
    logoW: n(s.logoW, 80, 500, 240),
    force: Boolean(s.force),
    buysEnabled: Boolean(s.buysEnabled),
    caption: String(s.caption == null ? '' : s.caption).slice(0, 120),
    startX: maybe(s.startX),
    startY: maybe(s.startY),
    startVx: maybe(s.startVx),
    startVy: maybe(s.startVy),
  };
}
