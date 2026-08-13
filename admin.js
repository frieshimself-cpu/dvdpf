/* Operator console (/admin). Renders nothing but a lock screen until the
 * server confirms the admin key via GET /api/settings + x-admin-key
 * (adminOk in the response). All controls POST /api/settings; viewers pick
 * changes up on their next poll. The preview canvas runs the same
 * deterministic sim as the public page, so it shows exactly what viewers see.
 */
import { createSim, clampSettings, oddsAt, ARENA_W, ARENA_H } from './sim.js';
import { drawFaucet } from './logo.js';

(() => {
  'use strict';

  const el = (id) => document.getElementById(id);
  const ui = {
    lock: el('lock'), lockForm: el('lockForm'), lockKey: el('lockKey'), lockError: el('lockError'),
    console: el('console'), serverStatus: el('serverStatus'),
    preview: el('preview'), pvCorners: el('pvCorners'), pvBuy: el('pvBuy'),
    odds: el('odds'), oddsReadout: el('oddsReadout'), oddsEta: el('oddsEta'),
    decayEnd: el('decayEnd'), decayHoursInput: el('decayHoursInput'),
    applyDecay: el('applyDecay'), stopDecay: el('stopDecay'), decayStatus: el('decayStatus'),
    speed: el('speed'), speedReadout: el('speedReadout'),
    size: el('size'), sizeReadout: el('sizeReadout'),
    captionInput: el('captionInput'),
    buysEnabled: el('buysEnabled'), buysLabel: el('buysLabel'),
    forceCorner: el('forceCorner'), lockBtn: el('lockBtn'),
    log: el('log'),
  };
  const pctx = ui.preview.getContext('2d');

  const DVD_COLORS = ['#ff8c00', '#ffd700', '#ff0080', '#00ffff', '#ff2d2d',
                      '#3dff3d', '#7cfc00', '#b44dff', '#ff6ec7', '#4d7cff'];
  const POLL_MS = 3000;

  const state = {
    key: '',
    settings: null,
    status: null,
    sim: null,
    simStartedAt: 0,
    skewMs: 0,
    unlocked: false,
    pollTimer: null,
  };

  const storage = {
    get() { try { return localStorage.getItem('dvd_admin_key') || ''; } catch { return ''; } },
    set(v) { try { localStorage.setItem('dvd_admin_key', v); } catch { /* blocked */ } },
    clear() { try { localStorage.removeItem('dvd_admin_key'); } catch { /* blocked */ } },
  };

  function logLine(msg, cls) {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = new Date().toLocaleTimeString();
    div.appendChild(t);
    div.appendChild(typeof msg === 'string' ? document.createTextNode(msg) : msg);
    ui.log.prepend(div);
    while (ui.log.childNodes.length > 40) ui.log.removeChild(ui.log.lastChild);
  }

  const serverNowMs = () => Date.now() + state.skewMs;
  const effectiveOdds = () => Math.round(oddsAt(state.settings, serverNowMs()));

  // ---------- auth ----------
  async function tryUnlock(key) {
    try {
      const res = await fetch('/api/settings', { headers: { 'x-admin-key': key } });
      const data = await res.json();
      if (!data.ok) {
        ui.lockError.textContent = data.error || `server error ${res.status}`;
        return false;
      }
      if (!data.status.adminKeyRequired) {
        ui.lockError.textContent = 'ADMIN_KEY env var is not set on the server — console disabled.';
        return false;
      }
      if (!data.adminOk) {
        ui.lockError.textContent = 'wrong key.';
        return false;
      }
      state.key = key;
      storage.set(key);
      state.unlocked = true;
      ui.lock.hidden = true;
      ui.console.hidden = false;
      absorb(data);
      state.pollTimer = setInterval(poll, POLL_MS);
      logLine('console unlocked');
      return true;
    } catch (e) {
      ui.lockError.textContent = `server unreachable: ${e.message}`;
      return false;
    }
  }

  ui.lockForm.addEventListener('submit', (e) => {
    e.preventDefault();
    ui.lockError.textContent = '';
    tryUnlock(ui.lockKey.value.trim());
  });

  ui.lockBtn.addEventListener('click', () => {
    storage.clear();
    location.reload();
  });

  // ---------- sync ----------
  function absorb(data) {
    state.skewMs = data.serverTime - Date.now();
    state.status = data.status;
    // Monotonic: ignore stale versions from cold instances (no KV store).
    if (!state.settings || data.settings.version > state.settings.version) {
      state.settings = clampSettings(data.settings);
      state.sim = createSim(state.settings);
      state.sim.advanceTo((serverNowMs() - state.settings.epochMs) / 1000);
      state.simStartedAt = performance.now();
      syncPanel();
    }
    if (data.lastBuy) {
      const a = document.createElement('a');
      a.href = data.lastBuy.solscan;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = `last buy: ${data.lastBuy.amountSol} SOL @ ${new Date(data.lastBuy.atMs).toLocaleTimeString()} ↗`;
      ui.pvBuy.replaceChildren(a);
    }
    updateStatusLine();
  }

  async function poll() {
    try {
      const res = await fetch('/api/settings', { headers: { 'x-admin-key': state.key } });
      const data = await res.json();
      if (data.ok) absorb(data);
    } catch { /* transient — next poll retries */ }
  }

  function updateStatusLine() {
    const s = state.status;
    if (!s) return;
    if (s.liveReady && state.settings.buysEnabled) {
      ui.serverStatus.textContent =
        `LIVE — ${s.buyAmountSol} SOL per corner · cooldown ${s.cooldownSeconds}s` +
        (s.durableStore ? '' : ' · ⚠ no KV store: settings may reset on cold start');
      ui.serverStatus.className = 'status live';
    } else {
      const missing = [];
      if (!s.walletConfigured) missing.push('DEV_WALLET_SECRET_KEY');
      else if (!s.walletValid) missing.push('DEV_WALLET_SECRET_KEY (set but unparseable)');
      if (!s.mintConfigured) missing.push('TOKEN_MINT');
      let text;
      if (s.liveReady && !state.settings.buysEnabled) text = 'READY — buys currently turned OFF';
      else if (missing.length) text = `DRY RUN — to go live set: ${missing.join(', ')}`;
      else text = 'DRY RUN (DRY_RUN=true) — buys simulated';
      if (!s.durableStore) text += ' · ⚠ no KV store';
      ui.serverStatus.textContent = text;
      ui.serverStatus.className = 'status dry';
    }
  }

  // ---------- panel ----------
  const MAX_ODDS = 5000;
  const LOG_MAX = Math.log10(MAX_ODDS);
  const sliderToOdds = (v) => Math.max(1, Math.round(Math.pow(10, (v / 1000) * LOG_MAX)));
  const oddsToSlider = (n) => Math.round((Math.log10(Math.min(MAX_ODDS, Math.max(1, n))) / LOG_MAX) * 1000);

  function updateDecayStatus() {
    if (!state.settings) return;
    const s = state.settings;
    const now = effectiveOdds();
    ui.oddsReadout.textContent = now === 1 ? 'EVERY bounce is a corner' : `1 in ${now.toLocaleString()} bounces`;
    if (s.decayHours > 0 && s.oddsEndN !== s.oddsN) {
      const endMs = (s.decayStartMs || s.epochMs) + s.decayHours * 3600000;
      const leftMs = endMs - serverNowMs();
      ui.decayStatus.textContent = leftMs > 0
        ? `decaying: 1 in ${s.oddsN.toLocaleString()} → 1 in ${s.oddsEndN.toLocaleString()} · now ~1 in ${now.toLocaleString()} · ${(leftMs / 3600000).toFixed(1)}h left`
        : `decay finished — holding at 1 in ${s.oddsEndN.toLocaleString()}`;
    } else {
      ui.decayStatus.textContent = 'no decay running';
    }
  }

  function updateEta() {
    if (!state.sim) return;
    const elapsed = (performance.now() - state.simStartedAt) / 1000;
    if (state.sim.bounceCount < 3 || elapsed < 3) {
      ui.oddsEta.textContent = 'expected corner hit: measuring…';
      return;
    }
    const ms = (elapsed / state.sim.bounceCount) * effectiveOdds() * 1000;
    let human;
    if (ms < 60000) human = `~${Math.max(1, Math.round(ms / 1000))}s`;
    else if (ms < 3600000) human = `~${(ms / 60000).toFixed(1)}min`;
    else human = `~${(ms / 3600000).toFixed(1)}h`;
    ui.oddsEta.textContent = `expected corner hit: every ${human}`;
  }

  function syncPanel() {
    const s = state.settings;
    ui.odds.value = oddsToSlider(s.oddsN);
    if (document.activeElement !== ui.decayEnd) ui.decayEnd.value = s.oddsEndN;
    if (document.activeElement !== ui.decayHoursInput && s.decayHours > 0) ui.decayHoursInput.value = s.decayHours;
    ui.speed.value = s.speed;
    ui.speedReadout.textContent = s.speed;
    ui.size.value = s.logoW;
    ui.sizeReadout.textContent = s.logoW;
    if (document.activeElement !== ui.captionInput) ui.captionInput.value = s.caption;
    ui.buysEnabled.checked = s.buysEnabled;
    ui.buysLabel.textContent = s.buysEnabled ? 'buys ON — corners spend real SOL when live' : 'buys OFF';
    ui.buysLabel.parentElement.classList.toggle('live', s.buysEnabled);
    updateDecayStatus();
    updateEta();
  }

  let pushTimer = null;
  const pending = {};
  function pushSettings(patch, immediate) {
    Object.assign(pending, patch);
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      const body = { ...pending };
      for (const k of Object.keys(pending)) delete pending[k];
      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-key': state.key },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (data.ok) {
          state.settings = null; // force absorb to rebuild
          absorb({ ok: true, serverTime: Date.now() + state.skewMs, settings: data.settings, status: state.status });
          logLine('settings pushed — viewers update within seconds', 'hit');
        } else {
          logLine(`settings rejected: ${data.error}`, 'err');
        }
      } catch (e) {
        logLine(`settings push failed: ${e.message}`, 'err');
      }
    }, immediate ? 0 : 500);
  }

  ui.odds.addEventListener('input', () => {
    const n = sliderToOdds(+ui.odds.value);
    ui.oddsReadout.textContent = n === 1 ? 'EVERY bounce is a corner' : `1 in ${n.toLocaleString()} bounces`;
  });
  ui.odds.addEventListener('change', () => pushSettings({ oddsN: sliderToOdds(+ui.odds.value) }));
  document.querySelectorAll('.presets button').forEach((b) => {
    b.addEventListener('click', () => pushSettings({ oddsN: +b.dataset.odds }, true));
  });
  ui.speed.addEventListener('input', () => { ui.speedReadout.textContent = ui.speed.value; });
  ui.speed.addEventListener('change', () => pushSettings({ speed: +ui.speed.value }));
  ui.size.addEventListener('input', () => { ui.sizeReadout.textContent = ui.size.value; });
  ui.size.addEventListener('change', () => pushSettings({ logoW: +ui.size.value }));
  ui.captionInput.addEventListener('change', () => pushSettings({ caption: ui.captionInput.value }));
  ui.buysEnabled.addEventListener('change', () => pushSettings({ buysEnabled: ui.buysEnabled.checked }, true));
  ui.forceCorner.addEventListener('click', () => {
    pushSettings({ force: true }, true);
    logLine('forcing a corner for everyone — incoming…');
  });
  ui.applyDecay.addEventListener('click', () => {
    pushSettings({
      oddsN: sliderToOdds(+ui.odds.value),
      oddsEndN: +ui.decayEnd.value,
      decayHours: +ui.decayHoursInput.value,
    }, true);
    logLine('decay started — odds cool off from the slider value');
  });
  ui.stopDecay.addEventListener('click', () => {
    pushSettings({ oddsN: effectiveOdds(), decayHours: 0 }, true);
    logLine('decay stopped — frozen at the current effective odds');
  });
  setInterval(() => {
    if (state.unlocked) { updateDecayStatus(); updateEta(); }
  }, 2000);

  // ---------- preview ----------
  let lastSeen = 0;
  function drawPreview() {
    if (state.sim) {
      const tNow = (serverNowMs() - state.settings.epochMs) / 1000;
      state.sim.advanceTo(tNow);
      if (state.sim.cornerCount > lastSeen) {
        lastSeen = state.sim.cornerCount;
        logLine('CORNER HIT (all viewers)', 'hit');
      }
      ui.pvCorners.textContent = state.sim.cornerCount;
      const pos = state.sim.positionAt(tNow);
      const sx = ui.preview.width / ARENA_W, sy = ui.preview.height / ARENA_H;
      pctx.fillStyle = '#03060c';
      pctx.fillRect(0, 0, ui.preview.width, ui.preview.height);
      const color = DVD_COLORS[state.sim.colorIndex % DVD_COLORS.length];
      drawFaucet(pctx, pos.x * sx, pos.y * sy, pos.w * sx, pos.h * sy, color);
    }
    requestAnimationFrame(drawPreview);
  }

  // ---------- boot ----------
  const saved = storage.get();
  if (saved) {
    ui.lockKey.value = saved;
    tryUnlock(saved);
  }
  requestAnimationFrame(drawPreview);
})();
