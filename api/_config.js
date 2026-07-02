import { createHash } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// SHA-256 of the operator key, so the console works with zero dashboard
// setup. Only the hash lives in the repo — the plaintext can't be recovered
// from it. Setting an ADMIN_KEY env var replaces this baked-in key entirely.
const ADMIN_KEY_SHA256 = '9cfe0a4efa953e4fd65097c18c5fa64afd86ebf3714e6b77d4ba6a46b5ca0d50';

export function isAdminKey(given) {
  if (typeof given !== 'string' || given.length === 0) return false;
  const envKey = (process.env.ADMIN_KEY || '').trim();
  if (envKey) return given === envKey;
  return createHash('sha256').update(given).digest('hex') === ADMIN_KEY_SHA256;
}

function num(value, fallback) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

export function loadServerConfig() {
  const env = process.env;
  const secret = (env.DEV_WALLET_SECRET_KEY || '').trim();
  const mint = (env.TOKEN_MINT || '').trim();
  const explicitDryRun = (env.DRY_RUN || '').toLowerCase() === 'true';
  return {
    secret,
    mint,
    rpcUrl: (env.SOLANA_RPC_URL || '').trim() || 'https://api.mainnet-beta.solana.com',
    buyAmountSol: num(env.BUY_AMOUNT_SOL, 1),
    slippagePercent: num(env.SLIPPAGE_PERCENT, 10),
    priorityFeeSol: num(env.PRIORITY_FEE_SOL, 0.0005),
    pool: (env.POOL || '').trim() || 'auto',
    cooldownSeconds: num(env.BUY_COOLDOWN_SECONDS, 60),
    explicitDryRun,
    // Live buys need the wallet and mint; anything missing degrades to dry
    // run. Admin auth is always configured (baked hash or ADMIN_KEY env).
    dryRun: explicitDryRun || !secret || !mint,
  };
}

export function parseKeypair(secret) {
  // Accepts a base58 string (Phantom-style export) or a JSON byte array (solana-keygen id.json).
  const raw = secret.startsWith('[')
    ? Uint8Array.from(JSON.parse(secret))
    : bs58.decode(secret);
  return Keypair.fromSecretKey(raw);
}
