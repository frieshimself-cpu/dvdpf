import { loadServerConfig, parseKeypair, isAdminKey } from './_config.js';
import { getSettings, putSettings, getLastBuy, hasDurableStore } from './_store.js';
import { createSim } from '../sim.js';

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  // Fallback for raw streams (local dev server).
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  try {
    return await handle(req, res);
  } catch (err) {
    console.error('settings handler crashed:', err);
    try {
      return res.status(500).json({ ok: false, error: `server error: ${String((err && err.stack) || err).slice(0, 500)}` });
    } catch { /* response already committed */ }
  }
}

async function handle(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const cfg = loadServerConfig();

  if (req.method === 'GET') {
    let walletValid = false;
    if (cfg.secret) {
      try { parseKeypair(cfg.secret); walletValid = true; } catch { walletValid = false; }
    }
    const settings = await getSettings();
    const lastBuy = await getLastBuy();
    // Lets the admin console verify a key without mutating anything.
    const adminOk = isAdminKey(req.headers['x-admin-key']);
    return res.status(200).json({
      ok: true,
      serverTime: Date.now(),
      adminOk,
      settings,
      lastBuy,
      status: {
        liveReady: !cfg.dryRun && walletValid,
        walletConfigured: Boolean(cfg.secret),
        walletValid,
        mintConfigured: Boolean(cfg.mint),
        adminKeyRequired: true, // always — baked hash or ADMIN_KEY env
        buyAmountSol: cfg.buyAmountSol,
        cooldownSeconds: cfg.cooldownSeconds,
        durableStore: hasDurableStore(),
      },
    });
  }

  if (req.method === 'POST') {
    if (!isAdminKey(req.headers['x-admin-key'])) {
      return res.status(401).json({ ok: false, error: 'invalid or missing x-admin-key' });
    }

    const body = await readBody(req);
    const current = await getSettings();
    const next = {
      ...current,
      ...(body.oddsN !== undefined && { oddsN: body.oddsN }),
      ...(body.oddsEndN !== undefined && { oddsEndN: body.oddsEndN }),
      ...(body.decayHours !== undefined && { decayHours: body.decayHours }),
      ...(body.speed !== undefined && { speed: body.speed }),
      ...(body.logoW !== undefined && { logoW: body.logoW }),
      ...(body.caption !== undefined && { caption: body.caption }),
      ...(body.buysEnabled !== undefined && { buysEnabled: Boolean(body.buysEnabled) }),
      force: Boolean(body.force), // one-shot: only sticks when explicitly sent
    };
    // Touching any odds/decay field restarts the ramp; other tweaks
    // (caption, speed, force) leave a running decay untouched.
    const decayTouched = body.oddsN !== undefined
      || body.oddsEndN !== undefined
      || body.decayHours !== undefined;
    next.decayStartMs = decayTouched ? Date.now() : (current.decayStartMs || current.epochMs);
    // Every change starts a fresh deterministic run so all viewers stay in
    // lockstep: new version, new seed, epoch = now. Carry the logo's exact
    // position and heading into the new run so nothing visibly jumps.
    const now = Date.now();
    try {
      const sim = createSim(current);
      const tNow = (now - current.epochMs) / 1000;
      sim.advanceTo(tNow);
      const st = sim.stateAt(tNow);
      next.startX = st.x;
      next.startY = st.y;
      next.startVx = st.vx;
      next.startVy = st.vy;
    } catch { /* fall back to a fresh random position */ }
    next.version = now;
    next.seed = now % 4294967295;
    next.epochMs = now;

    const saved = await putSettings(next);
    return res.status(200).json({ ok: true, settings: saved, durableStore: hasDurableStore() });
  }

  return res.status(405).json({ ok: false, error: 'GET or POST only' });
}
