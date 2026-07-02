import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

function num(value, fallback) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

export function loadServerConfig() {
  const env = process.env;
  const secret = (env.DEV_WALLET_SECRET_KEY || '').trim();
  const mint = (env.TOKEN_MINT || '').trim();
  const adminKey = (env.ADMIN_KEY || '').trim();
  const explicitDryRun = (env.DRY_RUN || '').toLowerCase() === 'true';
  return {
    secret,
    mint,
    adminKey,
    rpcUrl: (env.SOLANA_RPC_URL || '').trim() || 'https://api.mainnet-beta.solana.com',
    buyAmountSol: num(env.BUY_AMOUNT_SOL, 1),
    slippagePercent: num(env.SLIPPAGE_PERCENT, 10),
    priorityFeeSol: num(env.PRIORITY_FEE_SOL, 0.0005),
    pool: (env.POOL || '').trim() || 'auto',
    cooldownSeconds: num(env.BUY_COOLDOWN_SECONDS, 60),
    explicitDryRun,
    // Live buys need every safety box ticked; anything missing degrades to dry run.
    dryRun: explicitDryRun || !secret || !mint || !adminKey,
  };
}

export function parseKeypair(secret) {
  // Accepts a base58 string (Phantom-style export) or a JSON byte array (solana-keygen id.json).
  const raw = secret.startsWith('[')
    ? Uint8Array.from(JSON.parse(secret))
    : bs58.decode(secret);
  return Keypair.fromSecretKey(raw);
}
