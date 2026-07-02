import { Connection, VersionedTransaction } from '@solana/web3.js';
import { loadServerConfig, parseKeypair } from './_config.js';

// Best-effort cooldown per warm function instance. Vercel functions are
// stateless across cold starts, so this is a speed bump, not a vault door —
// the ADMIN_KEY requirement is the real gate on live buys.
let lastBuyAt = 0;

const PUMPPORTAL_URL = 'https://pumpportal.fun/api/trade-local';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POST only' });
  }

  const cfg = loadServerConfig();

  if (cfg.dryRun) {
    return res.status(200).json({
      ok: true,
      dryRun: true,
      amountSol: cfg.buyAmountSol,
      note: cfg.explicitDryRun
        ? 'DRY_RUN=true is set'
        : 'missing DEV_WALLET_SECRET_KEY, TOKEN_MINT or ADMIN_KEY',
    });
  }

  // Live path: caller must present the admin key.
  const given = req.headers['x-admin-key'];
  if (!given || given !== cfg.adminKey) {
    return res.status(401).json({ ok: false, error: 'invalid or missing x-admin-key' });
  }

  const now = Date.now();
  const cooldownMs = cfg.cooldownSeconds * 1000;
  if (now - lastBuyAt < cooldownMs) {
    const retryAfter = Math.ceil((cooldownMs - (now - lastBuyAt)) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      ok: false,
      error: `cooldown — next buy allowed in ${retryAfter}s`,
      retryAfter,
    });
  }
  lastBuyAt = now; // claim the slot before the slow network calls to block double-fires

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

    return res.status(200).json({
      ok: true,
      dryRun: false,
      amountSol: cfg.buyAmountSol,
      signature,
      solscan: `https://solscan.io/tx/${signature}`,
    });
  } catch (err) {
    lastBuyAt = 0; // buy never landed — release the cooldown slot
    return res.status(502).json({ ok: false, error: String(err.message || err) });
  }
}
