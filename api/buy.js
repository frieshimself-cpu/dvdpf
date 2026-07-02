import { Connection, VersionedTransaction } from '@solana/web3.js';
import { loadServerConfig, parseKeypair } from './_config.js';
import { createSim } from '../sim.js';
import { getSettings, claimCorner, claimCooldown, releaseCooldown, recordBuy } from './_store.js';

const PUMPPORTAL_URL = 'https://pumpportal.fun/api/trade-local';
// A reported corner must have happened this recently to count.
const VERIFY_WINDOW_MS = 20000;

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
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
    console.error('buy handler crashed:', err);
    try {
      return res.status(500).json({ ok: false, error: `server error: ${String((err && err.stack) || err).slice(0, 500)}` });
    } catch { /* response already committed */ }
  }
}

async function handle(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POST only' });
  }

  const cfg = loadServerConfig();
  const body = await readBody(req);
  const cornerIndex = Number(body.cornerIndex);
  if (!Number.isInteger(cornerIndex) || cornerIndex < 0) {
    return res.status(400).json({ ok: false, error: 'cornerIndex required' });
  }

  // No trust in the client: replay the deterministic sim server-side and
  // check that this corner actually happened, just now.
  const settings = await getSettings();
  const now = Date.now();
  const sim = createSim(settings);
  sim.advanceTo((now - settings.epochMs) / 1000 + 2);
  const corner = sim.corners.find((c) => c.index === cornerIndex);
  const cornerAtMs = corner ? settings.epochMs + corner.time * 1000 : null;
  if (!corner || now - cornerAtMs > VERIFY_WINDOW_MS || cornerAtMs - now > 3000) {
    return res.status(400).json({ ok: false, error: 'corner not verified' });
  }

  if (!settings.buysEnabled) {
    return res.status(200).json({ ok: true, skipped: 'buys are turned off' });
  }

  if (cfg.dryRun) {
    return res.status(200).json({
      ok: true,
      dryRun: true,
      amountSol: cfg.buyAmountSol,
      note: cfg.explicitDryRun
        ? 'DRY_RUN=true is set'
        : 'missing DEV_WALLET_SECRET_KEY or TOKEN_MINT',
    });
  }

  // One buy per corner, no matter how many viewers report it.
  if (!(await claimCorner(settings.version, cornerIndex))) {
    return res.status(200).json({ ok: true, duplicate: true });
  }
  // Cooldown backstop: corners that land inside it are skipped, not queued.
  if (!(await claimCooldown(cfg.cooldownSeconds))) {
    return res.status(200).json({ ok: true, skipped: 'cooldown' });
  }

  try {
    const keypair = parseKeypair(cfg.secret);

    const portalRes = await fetch(PUMPPORTAL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: keypair.publicKey.toBase58(),
        action: 'buy',
        mint: cfg.mint,
        amount: cfg.buyAmountSol,
        denominatedInSol: 'true',
        slippage: cfg.slippagePercent,
        priorityFee: cfg.priorityFeeSol,
        pool: cfg.pool,
      }),
    });

    if (!portalRes.ok) {
      const text = await portalRes.text().catch(() => '');
      throw new Error(`pumpportal ${portalRes.status}: ${text.slice(0, 200)}`);
    }

    const txBytes = new Uint8Array(await portalRes.arrayBuffer());
    const tx = VersionedTransaction.deserialize(txBytes);
    tx.sign([keypair]);

    const connection = new Connection(cfg.rpcUrl, 'confirmed');
    const signature = await connection.sendTransaction(tx, { maxRetries: 3 });

    const buyInfo = {
      signature,
      solscan: `https://solscan.io/tx/${signature}`,
      amountSol: cfg.buyAmountSol,
      atMs: Date.now(),
      cornerIndex,
      settingsVersion: settings.version, // cross-instance dedupe via Edge Config
    };
    await recordBuy(buyInfo);

    return res.status(200).json({ ok: true, dryRun: false, ...buyInfo });
  } catch (err) {
    await releaseCooldown(); // buy never landed — free the slot
    return res.status(502).json({ ok: false, error: String(err.message || err) });
  }
}
