import { loadServerConfig, parseKeypair } from './_config.js';
import { getSettings, putSettings, getLastBuy, hasDurableStore } from './_store.js';

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
  res.setHeader('Cache-Control', 'no-store');
  const cfg = loadServerConfig();

  if (req.method === 'GET') {
    let walletValid = false;
    if (cfg.secret) {
      try { parseKeypair(cfg.secret); walletValid = true; } catch { walletValid = false; }
    }
    const settings = await getSettings();
    const lastBuy = await getLastBuy();
    return res.status(200).json({
      ok: true,
      serverTime: Date.now(),
      settings,
      lastBuy,
      status: {
        liveReady: !cfg.dryRun && walletValid,
        walletConfigured: Boolean(cfg.secret),
        walletValid,
        mintConfigured: Boolean(cfg.mint),
        adminKeyRequired: Boolean(cfg.adminKey),
        buyAmountSol: cfg.buyAmountSol,
        cooldownSeconds: cfg.cooldownSeconds,
        durableStore: hasDurableStore(),
      },
    });
  }

  if (req.method === 'POST') {
    // Settings are locked until the operator sets ADMIN_KEY.
    if (!cfg.adminKey) {
      return res.status(403).json({ ok: false, error: 'settings locked — set ADMIN_KEY env var first' });
    }
    if (req.headers['x-admin-key'] !== cfg.adminKey) {
      return res.status(401).json({ ok: false, error: 'invalid or missing x-admin-key' });
    }

    const body = await readBody(req);
    const current = await getSettings();
    const next = {
      ...current,
      ...(body.oddsN !== undefined && { oddsN: body.oddsN }),
      ...(body.speed !== undefined && { speed: body.speed }),
      ...(body.logoW !== undefined && { logoW: body.logoW }),
      ...(body.caption !== undefined && { caption: body.caption }),
      ...(body.buysEnabled !== undefined && { buysEnabled: Boolean(body.buysEnabled) }),
      force: Boolean(body.force), // one-shot: only sticks when explicitly sent
    };
    // Every change starts a fresh deterministic run so all viewers stay in
    // lockstep: new version, new seed, epoch = now.
    next.version = Date.now();
    next.seed = next.version % 4294967295;
    next.epochMs = Date.now();

    const saved = await putSettings(next);
    return res.status(200).json({ ok: true, settings: saved, durableStore: hasDurableStore() });
  }

  return res.status(405).json({ ok: false, error: 'GET or POST only' });
}
