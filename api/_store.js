/* Settings + buy-dedupe storage. Uses Upstash Redis via REST when the Vercel
 * integration env vars are present (survives cold starts, consistent across
 * instances). Falls back to per-instance memory otherwise — functional, but
 * settings changes may revert on cold starts and dedupe is best-effort.
 */
import { clampSettings } from '../sim.js';

const SETTINGS_KEY = 'dvd:settings';
const LASTBUY_KEY = 'dvd:lastbuy';
const COOLDOWN_KEY = 'dvd:cooldown';

const mem = {
  settings: null,
  lastBuy: null,
  cooldownUntil: 0,
  boughtCorners: new Set(),
};

function kvEnv() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

export function hasDurableStore() {
  return Boolean(kvEnv());
}

async function redis(...command) {
  const kv = kvEnv();
  if (!kv) return undefined;
  const res = await fetch(kv.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${kv.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`kv error ${res.status}`);
  const data = await res.json();
  return data.result;
}

function num(value, fallback) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

// Default settings must be identical on every instance (no shared state), so
// the epoch is anchored to the current UTC day, not instance boot time.
export function defaultSettings() {
  return clampSettings({
    version: 1,
    seed: 1,
    epochMs: Math.floor(Date.now() / 86400000) * 86400000,
    oddsN: num(process.env.DEFAULT_ODDS, 100),
    speed: num(process.env.DEFAULT_SPEED, 320),
    logoW: num(process.env.DEFAULT_LOGO_W, 240),
    force: false,
    buysEnabled: (process.env.DEFAULT_BUYS_ENABLED || 'true').toLowerCase() !== 'false',
    caption: process.env.DEFAULT_CAPTION || 'every corner hit = dev buy \u{1F4C0}',
  });
}

export async function getSettings() {
  if (kvEnv()) {
    try {
      const raw = await redis('GET', SETTINGS_KEY);
      if (raw) return clampSettings(JSON.parse(raw));
    } catch { /* fall through to defaults */ }
    return defaultSettings();
  }
  return mem.settings || defaultSettings();
}

export async function putSettings(settings) {
  const clean = clampSettings(settings);
  if (kvEnv()) {
    await redis('SET', SETTINGS_KEY, JSON.stringify(clean));
  } else {
    mem.settings = clean;
  }
  return clean;
}

export async function getLastBuy() {
  if (kvEnv()) {
    try {
      const raw = await redis('GET', LASTBUY_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  return mem.lastBuy;
}

export async function recordBuy(info) {
  if (kvEnv()) {
    try {
      await redis('SET', LASTBUY_KEY, JSON.stringify(info));
    } catch { /* non-fatal */ }
  } else {
    mem.lastBuy = info;
  }
}

// Atomically claim a corner so N viewers reporting the same hit = 1 buy.
export async function claimCorner(version, cornerIndex) {
  const key = `dvd:buy:${version}:${cornerIndex}`;
  if (kvEnv()) {
    const result = await redis('SET', key, '1', 'NX', 'EX', '86400');
    return result === 'OK';
  }
  if (mem.boughtCorners.has(key)) return false;
  mem.boughtCorners.add(key);
  if (mem.boughtCorners.size > 500) {
    mem.boughtCorners.clear(); // crude bound; dedupe also covered by cooldown
  }
  return true;
}

// Atomically claim the cooldown slot.
export async function claimCooldown(seconds) {
  if (kvEnv()) {
    const result = await redis('SET', COOLDOWN_KEY, '1', 'NX', 'EX', String(Math.max(1, seconds)));
    return result === 'OK';
  }
  const now = Date.now();
  if (now < mem.cooldownUntil) return false;
  mem.cooldownUntil = now + seconds * 1000;
  return true;
}

export async function releaseCooldown() {
  if (kvEnv()) {
    try {
      await redis('DEL', COOLDOWN_KEY);
    } catch { /* non-fatal */ }
  } else {
    mem.cooldownUntil = 0;
  }
}
