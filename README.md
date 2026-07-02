# DVD CORNER BUY 📀

Retro DVD screensaver for your pump.fun coin. **Every viewer sees the exact
same bounce**, and every time the logo hits a corner dead-on, the site fires a
**dev buy** (default 1 SOL) on your token. Corner rarity is controlled
remotely — no visible admin panel on the site.

## How it works

- **Shared deterministic simulation** (`sim.js`) — the trajectory is computed
  from server-issued settings (seed, epoch, odds, speed, size). Browsers and
  the serverless functions run the identical engine, so everyone renders the
  same logo position and the server can *verify* corner hits independently.
- **Rigged odds** — every wall bounce rolls a 1-in-N chance to bend the
  trajectory into a guaranteed corner (speed stays constant, so it looks
  natural). N comes from the live settings.
- **Settings API** (`api/settings.js`) — `GET` is public (clients poll every
  4s and stay in lockstep); `POST` requires the `x-admin-key` header and
  restarts the simulation for all viewers within seconds.
- **Buy API** (`api/buy.js`) — viewers report corner hits, but the server
  replays the deterministic physics and only buys if the corner really
  happened just now. Forged requests are rejected; N viewers reporting the
  same corner produce exactly one buy (atomic dedupe + cooldown). Buys go
  through [PumpPortal's local trade API](https://pumpportal.fun/trading-api/)
  signed with the dev wallet key from env vars — the key never leaves the
  server.

## Controlling it (no panel on the site)

Change anything on the fly with one authenticated request:

```bash
curl -X POST https://YOUR-SITE.vercel.app/api/settings \
  -H "content-type: application/json" \
  -H "x-admin-key: YOUR_ADMIN_KEY" \
  -d '{"oddsN": 500}'
```

Accepted fields (any subset): `oddsN` (1–1,000,000 — corner every 1-in-N
bounces), `speed` (60–1200), `logoW` (80–500), `caption` (text under the
logo), `buysEnabled` (true/false), `force` (true = rig a corner within the
next few bounces — global, one-shot). Every open tab updates on its next poll
(≤4 s).

**Launch decay** — start hot and cool off automatically:

```bash
# corners every ~1-in-8 bounces at launch, easing to 1-in-2000 over 48h
curl -X POST https://YOUR-SITE.vercel.app/api/settings \
  -H "content-type: application/json" -H "x-admin-key: YOUR_ADMIN_KEY" \
  -d '{"oddsN": 8, "oddsEndN": 2000, "decayHours": 48}'
```

The corner *rate* declines linearly from start to end (deterministic — baked
into the physics, keeps running with zero maintenance). Touching any odds
field restarts the ramp; caption/speed/force changes leave it running. Set
`decayHours: 0` to stop decaying. Cold-start defaults: `DEFAULT_ODDS_END`,
`DEFAULT_DECAY_HOURS`.

There is also a **hidden operator panel**: open the site with `#ctl` appended
(`https://YOUR-SITE.vercel.app/#ctl`), enter the admin key once, and you get
sliders for the same controls. Visitors without the hash see nothing.

## Deploy to Vercel

1. Import the repo at [vercel.com/new](https://vercel.com/new) (framework
   preset **Other**, no build command). It runs immediately in dry-run mode.
2. **Recommended:** add the *Upstash for Redis* integration (Marketplace →
   Upstash → free tier) to the project. Without it, settings changes and buy
   dedupe live in function memory — they work, but may reset on cold starts
   and are not shared across concurrent instances.
3. Add environment variables:

| Variable | Required for live buys | Description |
| --- | --- | --- |
| `DEV_WALLET_SECRET_KEY` | ✅ | Dev wallet private key — base58 (Phantom export) or JSON byte array. Mark **Sensitive**. |
| `TOKEN_MINT` | ✅ | Your pump.fun coin's mint address. |
| `ADMIN_KEY` | ✅ | Secret for the settings API. Until it's set, settings are locked and buys stay in dry-run. |
| `SOLANA_RPC_URL` | recommended | Helius/QuickNode/etc. Defaults to the slow public RPC. |
| `BUY_AMOUNT_SOL` | optional | SOL per corner. Default `1`. |
| `BUY_COOLDOWN_SECONDS` | optional | Minimum seconds between buys. Default `60`. |
| `SLIPPAGE_PERCENT` / `PRIORITY_FEE_SOL` / `POOL` | optional | Defaults `10` / `0.0005` / `auto`. |
| `DRY_RUN` | optional | `true` forces simulated buys. |
| `DEFAULT_ODDS` / `DEFAULT_SPEED` / `DEFAULT_LOGO_W` / `DEFAULT_CAPTION` / `DEFAULT_BUYS_ENABLED` | optional | Cold-start defaults when no stored settings exist. |

4. Redeploy. The operator panel's status line shows LIVE / DRY RUN and which
   variables are missing.

## Safety notes

- Use a **dedicated hot wallet** holding only what you're willing to spend.
- Buys are physics-verified server-side: visitors can't forge corner hits, and
  duplicate reports of the same corner are collapsed into one buy.
- `ADMIN_KEY` guards the settings API (odds, buys on/off, force). Treat it
  like a password — anyone holding it can crank corner frequency to the
  cooldown limit.
- The cooldown and (without Upstash) dedupe are strongest with the Redis
  integration enabled; add it before going live.
- Buys are real, irreversible mainnet transactions. Ape responsibly.

## Local development

```bash
npm install
npx vercel dev
```

With no API reachable the site falls back to a free-running local screensaver
(no buys) and says so in the caption.
