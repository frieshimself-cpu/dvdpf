/* DVD CORNER BUY — synchronized viewer client.
 *
 * The bounce is a deterministic simulation (sim.js) driven by server-issued
 * settings, so every open tab renders the exact same trajectory. Clients poll
 * /api/settings every few seconds; when the version changes (operator moved
 * the odds, forced a corner, …) everyone rebuilds the sim in lockstep.
 * Corner hits are reported to /api/buy, where the server replays the same
 * physics before spending anything — clients are untrusted spectators.
 */
import { createSim, clampSettings, ARENA_W, ARENA_H } from './sim.js';

(() => {
  'use strict';

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const el = (id) => document.getElementById(id);
  const ui = {
    caption: el('caption'), captionText: el('captionText'),
    capCorners: el('capCorners'), capBuy: el('capBuy'),
    flash: el('flash'), banner: el('banner'),
    panel: el('panel'), serverStatus: el('serverStatus'),
    odds: el('odds'), oddsReadout: el('oddsReadout'), oddsEta: el('oddsEta'),
    speed: el('speed'), speedReadout: el('speedReadout'),
    size: el('size'), sizeReadout: el('sizeReadout'),
    captionInput: el('captionInput'),
    buysEnabled: el('buysEnabled'), buysLabel: el('buysLabel'),
    adminKey: el('adminKey'), forceCorner: el('forceCorner'),
    log: el('log'),
  };

  const DVD_COLORS = ['#ff8c00', '#ffd700', '#ff0080', '#00ffff', '#ff2d2d',
                      '#3dff3d', '#7cfc00', '#b44dff', '#ff6ec7', '#4d7cff'];
  const POLL_MS = 4000;
  const isOperator = location.hash === '#ctl';

  const state = {
    settings: null,     // current server settings (clamped)
    status: null,       // server status block
    sim: null,
    simStartedAt: 0,    // local perf reference for the ETA readout
    skewMs: 0,          // serverTime - local Date.now()
    seenCorners: 0,     // corners already rendered/reported for this sim
    localMode: false,   // no API reachable — free-running screensaver
    lastBuyAt: 0,
    particles: [],
  };

  // ---------- helpers ----------
  function logLine(msg, cls) {
    if (!isOperator) return;
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

  function serverNowMs() {
    return Date.now() + state.skewMs;
  }

  function rebuildSim(settings) {
    state.settings = settings;
    state.sim = createSim(settings);
    // Fast-forward and swallow corners from before we started watching.
    state.sim.advanceTo((serverNowMs() - settings.epochMs) / 1000);
    state.seenCorners = state.sim.cornerCount;
    state.simStartedAt = performance.now();
    updatePanelFromSettings();
    ui.captionText.textContent = settings.caption;
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);

  // ---------- server sync ----------
  async function poll() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (!data.ok) throw new Error('bad response');
      state.skewMs = data.serverTime - Date.now();
      state.status = data.status;
      state.localMode = false;
      if (!state.settings || data.settings.version !== state.settings.version) {
        rebuildSim(clampSettings(data.settings));
        logLine(`settings v${data.settings.version} — 1 in ${data.settings.oddsN} bounces`);
      }
      if (data.lastBuy && data.lastBuy.atMs !== state.lastBuyAt) {
        state.lastBuyAt = data.lastBuy.atMs;
        showBuy(data.lastBuy);
      }
      updateStatusLine();
    } catch {
      if (!state.settings) {
        // No API (static hosting / first load offline) — run free.
        state.localMode = true;
        rebuildSim(clampSettings({
          version: 1,
          seed: (Math.random() * 4294967295) >>> 0,
          epochMs: Date.now(),
          oddsN: 100, speed: 320, logoW: 240,
          force: false, buysEnabled: false,
          caption: 'offline screensaver mode',
        }));
        ui.serverStatus.textContent = 'no server API — local screensaver only';
        ui.serverStatus.className = 'status dry';
      }
    }
  }

  function updateStatusLine() {
    if (!isOperator || !state.status) return;
    const s = state.status;
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
      if (!s.adminKeyRequired) missing.push('ADMIN_KEY');
      let text;
      if (s.liveReady && !state.settings.buysEnabled) text = 'READY — buys currently turned OFF';
      else if (missing.length) text = `DRY RUN — to go live set: ${missing.join(', ')}`;
      else text = 'DRY RUN (DRY_RUN=true) — buys simulated';
      if (!s.durableStore) text += ' · ⚠ no KV store';
      ui.serverStatus.textContent = text;
      ui.serverStatus.className = 'status dry';
    }
  }

  // ---------- corner hits & buys ----------
  function cornerFx() {
    ui.flash.classList.remove('go'); void ui.flash.offsetWidth; ui.flash.classList.add('go');
    ui.banner.classList.remove('go'); void ui.banner.offsetWidth; ui.banner.classList.add('go');
    const sx = canvas.width / ARENA_W, sy = canvas.height / ARENA_H;
    const now = serverNowMs();
    const pos = state.sim.positionAt((now - state.settings.epochMs) / 1000);
    const cx = (pos.x + pos.w / 2) * sx, cy = (pos.y + pos.h / 2) * sy;
    for (let i = 0; i < 120; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 120 + Math.random() * 480;
      state.particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 1.4 + Math.random() * 0.8,
        color: DVD_COLORS[(Math.random() * DVD_COLORS.length) | 0],
      });
    }
  }

  function reportCorner(cornerIndex) {
    if (state.localMode) return;
    // Spread the stampede: every viewer reports, the server dedupes.
    setTimeout(async () => {
      try {
        const res = await fetch('/api/buy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cornerIndex }),
        });
        const data = await res.json().catch(() => ({}));
        if (data.ok && data.signature) showBuy(data);
        else if (data.ok && data.dryRun) logLine(`corner #${cornerIndex}: DRY RUN buy (${data.amountSol} SOL) — ${data.note}`);
        else if (data.ok && data.skipped) logLine(`corner #${cornerIndex}: skipped (${data.skipped})`);
        else if (data.ok && data.duplicate) logLine(`corner #${cornerIndex}: already bought by another viewer`);
        else if (!data.ok) logLine(`corner #${cornerIndex}: ${data.error}`, 'err');
      } catch (e) {
        logLine(`buy report failed: ${e.message}`, 'err');
      }
    }, Math.random() * 1500);
  }

  function showBuy(buy) {
    state.lastBuyAt = buy.atMs || Date.now();
    ui.capBuy.hidden = false;
    ui.capBuy.href = buy.solscan || `https://solscan.io/tx/${buy.signature}`;
    ui.capBuy.textContent = `⚡ last dev buy: ${buy.amountSol} SOL ↗`;
    const a = document.createElement('a');
    a.href = ui.capBuy.href; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = `BUY SENT (${buy.amountSol} SOL) — view tx`;
    logLine(a, 'hit');
  }

  // ---------- rendering ----------
  function drawLogo(pos) {
    const sx = canvas.width / ARENA_W, sy = canvas.height / ARENA_H;
    const x = pos.x * sx, y = pos.y * sy, w = pos.w * sx, h = pos.h * sy;
    const color = DVD_COLORS[state.sim.colorIndex % DVD_COLORS.length];
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
    ctx.fillStyle = color;
    ctx.font = `italic 900 ${h * 0.62}px "Arial Black", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DVD', w / 2, h * 0.30);
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.78, w * 0.46, h * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.font = `900 ${h * 0.17}px "Arial Black", Arial, sans-serif`;
    ctx.fillText('V I D E O', w / 2, h * 0.79);
    ctx.restore();
  }

  function drawParticles(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.life -= dt;
      if (p.life <= 0) { state.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 420 * dt;
      ctx.globalAlpha = Math.min(1, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 5, 5);
    }
    ctx.globalAlpha = 1;
  }

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;

    if (state.sim) {
      const tNow = (serverNowMs() - state.settings.epochMs) / 1000;
      state.sim.advanceTo(tNow);

      // Fire FX + buy reports for corners that just happened.
      if (state.sim.cornerCount > state.seenCorners) {
        for (const c of state.sim.corners) {
          if (c.index >= state.seenCorners) {
            cornerFx();
            reportCorner(c.index);
          }
        }
        state.seenCorners = state.sim.cornerCount;
        updateEta();
      }
      ui.capCorners.textContent = state.sim.cornerCount;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawLogo(state.sim.positionAt(tNow));
      drawParticles(dt);
    }
    requestAnimationFrame(frame);
  }

  // ---------- operator panel ----------
  const MAX_ODDS = 5000;
  const LOG_MAX = Math.log10(MAX_ODDS);
  const sliderToOdds = (v) => Math.max(1, Math.round(Math.pow(10, (v / 1000) * LOG_MAX)));
  const oddsToSlider = (n) => Math.round((Math.log10(Math.min(MAX_ODDS, Math.max(1, n))) / LOG_MAX) * 1000);

  function updatePanelFromSettings() {
    if (!isOperator || !state.settings) return;
    const s = state.settings;
    ui.odds.value = oddsToSlider(s.oddsN);
    ui.oddsReadout.textContent = s.oddsN === 1 ? 'EVERY bounce is a corner' : `1 in ${s.oddsN.toLocaleString()} bounces`;
    ui.speed.value = s.speed;
    ui.speedReadout.textContent = s.speed;
    ui.size.value = s.logoW;
    ui.sizeReadout.textContent = s.logoW;
    if (document.activeElement !== ui.captionInput) ui.captionInput.value = s.caption;
    ui.buysEnabled.checked = s.buysEnabled;
    ui.buysLabel.textContent = s.buysEnabled ? 'buys ON — corners spend real SOL when live' : 'buys OFF';
    ui.buysLabel.parentElement.classList.toggle('live', s.buysEnabled);
    updateEta();
    updateStatusLine();
  }

  function updateEta() {
    if (!isOperator || !state.sim) return;
    const elapsed = (performance.now() - state.simStartedAt) / 1000;
    if (state.sim.bounceCount < 3 || elapsed < 3) {
      ui.oddsEta.textContent = 'expected corner hit: measuring…';
      return;
    }
    const secsPerBounce = elapsed / state.sim.bounceCount;
    const ms = secsPerBounce * state.settings.oddsN * 1000;
    let human;
    if (ms < 60000) human = `~${Math.max(1, Math.round(ms / 1000))}s`;
    else if (ms < 3600000) human = `~${(ms / 60000).toFixed(1)}min`;
    else human = `~${(ms / 3600000).toFixed(1)}h`;
    ui.oddsEta.textContent = `expected corner hit: every ${human}`;
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
          headers: { 'Content-Type': 'application/json', 'x-admin-key': ui.adminKey.value.trim() },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (data.ok) {
          rebuildSim(clampSettings(data.settings));
          logLine('settings pushed — all viewers update within seconds', 'hit');
        } else {
          logLine(`settings rejected: ${data.error}`, 'err');
        }
      } catch (e) {
        logLine(`settings push failed: ${e.message}`, 'err');
      }
    }, immediate ? 0 : 500);
  }

  function wirePanel() {
    ui.panel.hidden = false;
    try {
      ui.adminKey.value = localStorage.getItem('dvd_admin_key') || '';
    } catch { /* storage blocked */ }
    ui.adminKey.addEventListener('change', () => {
      try { localStorage.setItem('dvd_admin_key', ui.adminKey.value.trim()); } catch { /* ignore */ }
    });

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
  }

  // ---------- boot ----------
  resize();
  if (isOperator) wirePanel();
  poll();
  setInterval(poll, POLL_MS);
  requestAnimationFrame(frame);
})();
