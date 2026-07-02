import { loadServerConfig, parseKeypair } from './_config.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'GET only' });
  }

  const cfg = loadServerConfig();

  // Validate the secret parses, but never expose key material — not even the
  // public key: no need to hand front-run bots the hot wallet before it trades.
  let walletValid = false;
  if (cfg.secret) {
    try {
      parseKeypair(cfg.secret);
      walletValid = true;
    } catch {
      walletValid = false;
    }
  }

  const liveReady = !cfg.dryRun && walletValid;

  return res.status(200).json({
    ok: true,
    dryRun: !liveReady,
    liveReady,
    mint: cfg.mint || null,
    buyAmountSol: cfg.buyAmountSol,
    cooldownSeconds: cfg.cooldownSeconds,
    pool: cfg.pool,
    adminKeyRequired: Boolean(cfg.adminKey),
    walletConfigured: Boolean(cfg.secret),
    walletValid,
  });
}
