# DVD CORNER BUY 📀

Retro DVD screensaver for your pump.fun coin. The logo bounces around forever —
and every time it hits a corner dead-on, the site fires a **dev buy** (default
1 SOL) on your token. A live control panel lets you tune exactly how rare a
corner hit is, in real time.

## How it works

- **Frontend** (`index.html`, `app.js`, `styles.css`) — canvas screensaver with
  rigged physics. Every wall bounce rolls a 1-in-N chance to "arm" a corner;
  once armed, the logo's trajectory is bent (imperceptibly — overall speed is
  kept constant) so it reaches both walls at the same instant. N comes straight
  off the rarity slider, so dragging it changes the odds instantly, and the
  panel shows a live "expected corner every ~X" estimate based on the measured
  bounce rate.
- **Backend** (`api/buy.js`) — a Vercel serverless function. On a corner hit
  the frontend POSTs to `/api/buy`; the function builds a buy transaction via
  [PumpPortal's local trade API](https://pumpportal.fun/trading-api/), signs it
  with your dev wallet (key lives only in a Vercel env var, never in the
  browser), and submits it to Solana. Works for bonding-curve coins and
  graduated coins (`pool: auto`).

## Deploy to Vercel

1. Push this repo to GitHub and import it at [vercel.com/new](https://vercel.com/new)
   (framework preset: **Other**, no build command needed). Or use the CLI:
   `npx vercel`.
2. In the Vercel project → **Settings → Environment Variables**, add:

| Variable | Required for live buys | Description |
| --- | --- | --- |
| `DEV_WALLET_SECRET_KEY` | ✅ | Dev wallet private key — base58 string (Phantom export) or JSON byte array (`id.json`). Mark it **Sensitive**. |
| `TOKEN_MINT` | ✅ | Your pump.fun coin's mint address. |
| `ADMIN_KEY` | ✅ | A secret you invent. Live buys only fire for requests carrying it — enter it in the site's panel. Without it random visitors could drain the wallet. |
| `SOLANA_RPC_URL` | recommended | Your RPC endpoint (Helius/QuickNode/Triton). Defaults to the public mainnet RPC, which is slow and rate-limited. |
| `BUY_AMOUNT_SOL` | optional | SOL per corner hit. Default `1`. |
| `BUY_COOLDOWN_SECONDS` | optional | Minimum seconds between buys. Default `60`. |
| `SLIPPAGE_PERCENT` | optional | Default `10`. |
| `PRIORITY_FEE_SOL` | optional | Default `0.0005`. |
| `POOL` | optional | `auto` (default), `pump`, `pump-amm`, `raydium`, … |
| `DRY_RUN` | optional | `true` forces simulated buys even with everything configured. |

3. Redeploy. The panel's status line tells you whether you're **LIVE** or in
   **DRY RUN**, and which variables are still missing.

Until all three required variables are set, `/api/buy` runs in dry-run mode and
just simulates — safe to deploy first and wire the wallet later.

## Using the panel

- **Corner rarity** — slider from *every bounce* to *1 in 5000 bounces*
  (log scale), with presets. Applies instantly; the ETA readout updates live.
- **Speed / logo size** — real-time screensaver tuning.
- **Dev buy** — an ARM checkbox (corners only trigger buys while armed in that
  browser tab) and the admin key field. `FORCE CORNER NOW` rigs the very next
  bounce into a corner; `TEST BUY CALL` hits the API without waiting.
- **Stats & event log** — bounces, corner hits, buys sent, SOL spent, and a
  feed with Solscan links for every transaction.

## Safety notes

- Use a **dedicated hot wallet** holding only what you're willing to spend.
  Anything in `DEV_WALLET_SECRET_KEY` can be spent by the deployment.
- Live buys require the `ADMIN_KEY` header, so spectators watching your site
  see the corner hits but cannot spend your SOL. Only arm buys in a browser
  where you've entered the key.
- The cooldown is enforced per warm serverless instance (best effort). The
  admin key is the real protection; the cooldown just stops accidental
  double-fires.
- Buys are real, irreversible mainnet transactions. Ape responsibly.

## Local development

```bash
npm install
npx vercel dev
```

Opening `index.html` directly (or via any static server) also works — with no
API reachable the site runs as a pure screensaver and says so in the panel.
