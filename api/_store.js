/* Settings + buy-dedupe storage, best available tier first:
 *
 * 1. Upstash Redis (marketplace integration) — atomic SETNX dedupe/cooldown.
 * 2. Vercel Edge Config — durable, consistent settings across instances and
 *    cold starts (reads via connection string, writes via VERCEL_API_TOKEN).
 *    Not atomic, so dedupe/cooldown add an Edge-Config-backed lastBuy check
 *    on top of per-instance memory.
 * 3. Per-instance memory — functional fallback, resets on cold start.
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

// ---------- tier 1: Upstash Redis ----------
function kvEnv() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
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

// ---------- tier 2: Edge Config ----------
function edgeEnv() {
  const conn = (process.env.EDGE_CONFIG || '').trim();
  const m = conn.match(/edge-config\.vercel\.com\/([^/?]+)\?token=([^&]+)/);
  if (!m) return null;
  return { id: m[1], readToken: m[2], writeToken: (process.env.VERCEL_API_TOKEN || '').trim() };
}

async function edgeRead(key) {
  const ec = edgeEnv();
  if (!ec) return undefined;
  const res = await fetch(`https://edge-config.vercel.com/${ec.id}/item/${key}?token=${ec.readToken}`);
  if (res.status === 404) return null; // item absent
  if (!res.ok) throw new Error(`edge-config read ${res.status}`);
  return await res.json();
}

async function edgeWrite(key, value) {
  const ec = edgeEnv();
  if (!ec || !ec.writeToken) return false;
  const res = await fetch(`https://api.vercel.com/v1/edge-config/${ec.id}/items`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${ec.writeToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ operation: 'upsert', key: key.replace(/:/g, '_'), value }] }),
  });
  return res.ok;
}

function edgeKey(key) {
  return key.replace(/:/g, '_'); // edge config keys allow [a-zA-Z0-9_-]
}

export function hasDurableStore() {
  const ec = edgeEnv();
  return Boolean(kvEnv()) || Boolean(ec && ec.writeToken);
}

function num(value, fallback) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

// Default settings must be identical on every instance (no shared state), so
// the epoch is anchored to the current UTC day, not instance boot time.
export function defaultSettings() {
  const dayAnchor = Math.floor(Date.now() / 86400000) * 86400000;
  const oddsN = num(process.env.DEFAULT_ODDS, 100);
  return clampSettings({
    version: 1,
    seed: 1,
    epochMs: dayAnchor,
    oddsN,
    oddsEndN: num(process.env.DEFAULT_ODDS_END, oddsN),
    decayHours: num(process.env.DEFAULT_DECAY_HOURS, 0),
    decayStartMs: dayAnchor,
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
      return defaultSettings();
    } catch { /* fall through */ }
  }
  try {
    const stored = await edgeRead(edgeKey(SETTINGS_KEY));
    if (stored) return clampSettings(stored);
    if (stored === null) return mem.settings || defaultSettings();
  } catch { /* fall through */ }
  return mem.settings || defaultSettings();
}

export async function putSettings(settings) {
  const clean = clampSettings(settings);
  mem.settings = clean;
  if (kvEnv()) {
    try { await redis('SET', SETTINGS_KEY, JSON.stringify(clean)); } catch { /* memory holds */ }
  }
  try { await edgeWrite(SETTINGS_KEY, clean); } catch { /* memory holds */ }
  return clean;
}

export async function getLastBuy() {
  if (kvEnv()) {
    try {
      const raw = await redis('GET', LASTBUY_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* fall through */ }
  }
  try {
    const stored = await edgeRead(edgeKey(LASTBUY_KEY));
    if (stored) return stored;
  } catch { /* fall through */ }
  return mem.lastBuy;
}

export async function recordBuy(info) {
  mem.lastBuy = info;
  if (kvEnv()) {
    try { await redis('SET', LASTBUY_KEY, JSON.stringify(info)); } catch { /* non-fatal */ }
  }
  try { await edgeWrite(LASTBUY_KEY, info); } catch { /* non-fatal */ }
}

// Atomically claim a corner so N viewers reporting the same hit = 1 buy.
// Redis gives a true atomic claim; the Edge Config tier narrows the race to
// its write-propagation window via the lastBuy record; memory covers the rest.
export async function claimCorner(version, cornerIndex) {
  const key = `dvd:buy:${version}:${cornerIndex}`;
  if (kvEnv()) {
    const result = await redis('SET', key, '1', 'NX', 'EX', '86400');
    return result === 'OK';
  }
  try {
    const last = await edgeRead(edgeKey(LASTBUY_KEY));
    if (last && last.settingsVersion === version && last.cornerIndex === cornerIndex) return false;
  } catch { /* fall through to memory */ }
  if (mem.boughtCorners.has(key)) return false;
  mem.boughtCorners.add(key);
  if (mem.boughtCorners.size > 500) mem.boughtCorners.clear();
  return true;
}

// Atomically claim the cooldown slot.
export async function claimCooldown(seconds) {
  if (kvEnv()) {
    const result = await redis('SET', COOLDOWN_KEY, '1', 'NX', 'EX', String(Math.max(1, seconds)));
    return result === 'OK';
  }
  const now = Date.now();
  try {
    const last = await edgeRead(edgeKey(LASTBUY_KEY));
    if (last && now - last.atMs < seconds * 1000) return false;
  } catch { /* fall through to memory */ }
  if (now < mem.cooldownUntil) return false;
  mem.cooldownUntil = now + seconds * 1000;
  return true;
}

export async function releaseCooldown() {
  mem.cooldownUntil = 0;
  if (kvEnv()) {
    try { await redis('DEL', COOLDOWN_KEY); } catch { /* non-fatal */ }
  }
}
