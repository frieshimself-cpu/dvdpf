/* DVD CORNER BUY — retro screensaver with rigged corner odds.
 *
 * Physics trick: the logo bounces naturally, but every wall bounce rolls a
 * 1-in-N chance to "arm" a corner. Once armed, the perpendicular velocity is
 * adjusted so the logo reaches both walls at the exact same instant — a
 * guaranteed corner hit — then the whole velocity vector is rescaled so the
 * perceived speed never changes. N comes straight off the rarity slider, so
 * dragging it retunes the odds instantly.
 */
(() => {
  'use strict';

  // ---------- DOM ----------
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const el = (id) => document.getElementById(id);
  const ui = {
    odds: el('odds'), oddsReadout: el('oddsReadout'), oddsEta: el('oddsEta'),
    speed: el('speed'), speedReadout: el('speedReadout'),
    size: el('size'), sizeReadout: el('sizeReadout'),
    arm: el('arm'), armLabel: el('armLabel'),
    adminKey: el('adminKey'),
    testCorner: el('testCorner'), testBuy: el('testBuy'),
    statBounces: el('statBounces'), statCorners: el('statCorners'),
    statBuys: el('statBuys'), statSol: el('statSol'),
    log: el('log'), serverStatus: el('serverStatus'),
    panel: el('panel'), panelToggle: el('panelToggle'),
    flash: el('flash'), banner: el('banner'),
  };

  // ---------- state ----------
  const MAX_ODDS = 5000;
  const CORNER_EPS = 2; // px slack when deciding a bounce also kissed the other wall

  const state = {
    x: 80, y: 80,
    vx: 1, vy: 0.8,           // direction is what matters; magnitude renormalized to speed
    speed: 320,               // px/s
    logoW: 180, logoH: 90,
    colorIdx: 0,
    oddsN: 50,                // 1-in-N bounces hits a corner
    cornerArmed: false,       // next feasible bounce gets aimed at a corner
    buyAmountSol: null,       // from server config, display only
    bounces: 0, corners: 0, buys: 0, solSpent: 0,
    bounceTimes: [],          // recent bounce timestamps for the ETA readout
  };

  const DVD_COLORS = ['#ff8c00', '#ffd700', '#ff0080', '#00ffff', '#ff2d2d',
                      '#3dff3d', '#7cfc00', '#b44dff', '#ff6ec7', '#4d7cff'];

  const particles = []; // corner-hit confetti

  // ---------- helpers ----------
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

  function renormalizeVelocity() {
    const mag = Math.hypot(state.vx, state.vy) || 1;
    state.vx = (state.vx / mag) * state.speed;
    state.vy = (state.vy / mag) * state.speed;
  }

  // Largest logo width that still leaves room to bounce on both axes.
  function maxLogoW() {
    return Math.max(40, Math.min(canvas.width, canvas.height * 2) - 40);
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const fit = maxLogoW();
    if (state.logoW > fit) {
      state.logoW = fit;
      state.logoH = Math.round(fit / 2);
      ui.sizeReadout.textContent = `${state.logoW} px`;
    }
    state.x = Math.min(Math.max(state.x, 0), Math.max(0, canvas.width - state.logoW));
    state.y = Math.min(Math.max(state.y, 0), Math.max(0, canvas.height - state.logoH));
  }
  window.addEventListener('resize', resize);

  // ---------- rarity engine ----------
  // After bouncing off one wall, bend the other axis so both walls are reached
  // simultaneously. Uniform rescaling afterwards preserves the simultaneity,
  // so the aim survives the constant-speed constraint.
  function tryAimAtCorner(bouncedX) {
    const W = canvas.width, H = canvas.height;
    if (bouncedX) {
      const distX = state.vx > 0 ? (W - state.logoW - state.x) : state.x;
      const distY = state.vy > 0 ? (H - state.logoH - state.y) : state.y;
      if (distX <= 0 || distY <= 0 || Math.abs(state.vx) < 1e-6) return;
      const needed = distY / (distX / Math.abs(state.vx));
      const ratio = needed / (Math.abs(state.vy) || 1e-6);
      if (ratio < 0.15 || ratio > 6.5) return; // too steep/flat — retry next bounce
      state.vy = Math.sign(state.vy || 1) * needed;
    } else {
      const distY = state.vy > 0 ? (H - state.logoH - state.y) : state.y;
      const distX = state.vx > 0 ? (W - state.logoW - state.x) : state.x;
      if (distY <= 0 || distX <= 0 || Math.abs(state.vy) < 1e-6) return;
      const needed = distX / (distY / Math.abs(state.vy));
      const ratio = needed / (Math.abs(state.vx) || 1e-6);
      if (ratio < 0.15 || ratio > 6.5) return;
      state.vx = Math.sign(state.vx || 1) * needed;
    }
    renormalizeVelocity();
  }

  function recordBounce() {
    state.bounces++;
    state.colorIdx = (state.colorIdx + 1) % DVD_COLORS.length;
    const now = performance.now();
    state.bounceTimes.push(now);
    if (state.bounceTimes.length > 24) state.bounceTimes.shift();
    ui.statBounces.textContent = state.bounces;
    updateEta();
  }

  function avgBounceIntervalMs() {
    const t = state.bounceTimes;
    if (t.length < 3) return null;
    return (t[t.length - 1] - t[0]) / (t.length - 1);
  }

  function updateEta() {
    const iv = avgBounceIntervalMs();
    if (!iv) { ui.oddsEta.textContent = 'expected corner hit: measuring…'; return; }
    const ms = iv * state.oddsN;
    let human;
    if (ms < 60_000) human = `~${Math.max(1, Math.round(ms / 1000))}s`;
    else if (ms < 3_600_000) human = `~${(ms / 60_000).toFixed(1)}min`;
    else human = `~${(ms / 3_600_000).toFixed(1)}h`;
    ui.oddsEta.textContent = `expected corner hit: every ${human} at current speed`;
  }

  // ---------- corner hit ----------
  function cornerHit() {
    state.corners++;
    state.cornerArmed = false;
    ui.statCorners.textContent = state.corners;

    // A perfect corner reverses velocity exactly, which would make the logo
    // retrace its path (and re-hit the previous corner forever). Jitter the
    // outgoing components — signs preserved — to break the symmetry.
    state.vx *= 1 + (Math.random() - 0.5) * 0.3;
    state.vy *= 1 + (Math.random() - 0.5) * 0.3;
    renormalizeVelocity();

    ui.flash.classList.remove('go'); void ui.flash.offsetWidth; ui.flash.classList.add('go');
    ui.banner.classList.remove('go'); void ui.banner.offsetWidth; ui.banner.classList.add('go');

    const cx = state.x + state.logoW / 2, cy = state.y + state.logoH / 2;
    for (let i = 0; i < 120; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 120 + Math.random() * 480;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 1.4 + Math.random() * 0.8,
        color: DVD_COLORS[(Math.random() * DVD_COLORS.length) | 0],
      });
    }

    logLine('CORNER HIT!', 'hit');
    triggerBuy();
  }

  async function triggerBuy() {
    if (!ui.arm.checked) {
      logLine('buys disarmed — no buy sent');
      return;
    }
    logLine('sending dev buy…', 'hit');
    try {
      const headers = { 'Content-Type': 'application/json' };
      const key = ui.adminKey.value.trim();
      if (key) headers['x-admin-key'] = key;
      const res = await fetch('/api/buy', {
        method: 'POST',
        headers,
        body: JSON.stringify({ trigger: 'corner', corners: state.corners }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && data.dryRun) {
        logLine(`DRY RUN — buy simulated (${data.amountSol} SOL) — ${data.note || 'set env vars to go live'}`);
      } else if (res.ok && data.ok) {
        state.buys++;
        state.solSpent = +(state.solSpent + (data.amountSol || 0)).toFixed(3);
        ui.statBuys.textContent = state.buys;
        ui.statSol.textContent = state.solSpent;
        const a = document.createElement('a');
        a.href = data.solscan || `https://solscan.io/tx/${data.signature}`;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = `BUY SENT (${data.amountSol} SOL) — view tx`;
        logLine(a, 'hit');
      } else {
        logLine(`buy failed: ${data.error || res.status}`, 'err');
      }
    } catch (e) {
      logLine(`buy failed: ${e.message}`, 'err');
    }
  }

  // ---------- physics ----------
  function step(dt) {
    const W = canvas.width, H = canvas.height;
    const maxX = Math.max(0, W - state.logoW);
    const maxY = Math.max(0, H - state.logoH);

    let nx = state.x + state.vx * dt;
    let ny = state.y + state.vy * dt;
    let bx = false, by = false;

    if (nx <= 0) { nx = Math.min(-nx, maxX); state.vx = Math.abs(state.vx); bx = true; }
    else if (nx >= maxX) { nx = Math.max(2 * maxX - nx, 0); state.vx = -Math.abs(state.vx); bx = true; }
    if (ny <= 0) { ny = Math.min(-ny, maxY); state.vy = Math.abs(state.vy); by = true; }
    else if (ny >= maxY) { ny = Math.max(2 * maxY - ny, 0); state.vy = -Math.abs(state.vy); by = true; }

    // A bounce that lands within a hair of the other wall counts as a corner.
    if (bx && !by && (ny <= CORNER_EPS || ny >= maxY - CORNER_EPS)) {
      state.vy = ny <= CORNER_EPS ? Math.abs(state.vy) : -Math.abs(state.vy);
      ny = ny <= CORNER_EPS ? 0 : maxY;
      by = true;
    } else if (by && !bx && (nx <= CORNER_EPS || nx >= maxX - CORNER_EPS)) {
      state.vx = nx <= CORNER_EPS ? Math.abs(state.vx) : -Math.abs(state.vx);
      nx = nx <= CORNER_EPS ? 0 : maxX;
      bx = true;
    }

    state.x = nx;
    state.y = ny;

    if (bx || by) {
      recordBounce();
      const isCorner = bx && by;
      if (isCorner) cornerHit();
      // Roll after every bounce — including the corner itself, so at 1-in-1
      // odds the logo chains corner-to-corner forever.
      if (!state.cornerArmed && Math.random() < 1 / state.oddsN) {
        state.cornerArmed = true;
      }
      if (state.cornerArmed) tryAimAtCorner(isCorner || bx);
    }
  }

  // ---------- rendering ----------
  function drawLogo() {
    const { x, y, logoW: w, logoH: h } = state;
    const color = DVD_COLORS[state.colorIdx];
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;

    // "DVD" wordmark
    ctx.fillStyle = color;
    ctx.font = `italic 900 ${h * 0.62}px "Arial Black", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DVD', w / 2, h * 0.30);

    // disc ellipse with punched-out VIDEO text
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.78, w * 0.46, h * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.font = `900 ${h * 0.17}px "Arial Black", Arial, sans-serif`;
    ctx.fillText('V I D E O', w / 2, h * 0.79);
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  function drawParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 420 * dt; // gravity
      ctx.globalAlpha = Math.min(1, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 5, 5);
    }
    ctx.globalAlpha = 1;
  }

  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min((now - lastT) / 1000, 0.05); // clamp tab-switch jumps
    lastT = now;
    step(dt);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawLogo();
    drawParticles(dt);
    requestAnimationFrame(frame);
  }

  // ---------- panel wiring ----------
  const LOG_MAX = Math.log10(MAX_ODDS);
  function sliderToOdds(v) {
    return Math.max(1, Math.round(Math.pow(10, (v / 1000) * LOG_MAX)));
  }
  function oddsToSlider(n) {
    return Math.round((Math.log10(Math.max(1, n)) / LOG_MAX) * 1000);
  }

  function applyOdds() {
    state.oddsN = sliderToOdds(+ui.odds.value);
    // New odds apply immediately: cancel any in-flight rigged corner and
    // jitter the trajectory so an already-aimed flight path misses.
    if (state.cornerArmed) {
      state.cornerArmed = false;
      state.vx *= 1 + (Math.random() - 0.5) * 0.12;
      state.vy *= 1 + (Math.random() - 0.5) * 0.12;
      renormalizeVelocity();
    }
    ui.oddsReadout.textContent = state.oddsN === 1
      ? 'EVERY bounce is a corner'
      : `1 in ${state.oddsN.toLocaleString()} bounces`;
    updateEta();
  }
  ui.odds.addEventListener('input', applyOdds);
  document.querySelectorAll('.presets button').forEach((b) => {
    b.addEventListener('click', () => {
      ui.odds.value = oddsToSlider(+b.dataset.odds);
      applyOdds();
      logLine(`corner odds set to 1 in ${sliderToOdds(+ui.odds.value).toLocaleString()}`);
    });
  });

  function applySpeed() {
    state.speed = +ui.speed.value;
    ui.speedReadout.textContent = `${state.speed} px/s`;
    renormalizeVelocity();
    state.bounceTimes.length = 0; // old cadence no longer predicts the ETA
    updateEta();
  }
  ui.speed.addEventListener('input', applySpeed);

  function applySize() {
    state.logoW = Math.min(+ui.size.value, maxLogoW());
    state.logoH = Math.round(state.logoW / 2);
    ui.sizeReadout.textContent = `${state.logoW} px`;
    resize();
  }
  ui.size.addEventListener('input', applySize);

  ui.arm.addEventListener('change', () => {
    const on = ui.arm.checked;
    ui.armLabel.textContent = on
      ? 'buys ARMED — corner hits send real orders'
      : 'buys DISARMED — corners are just for show';
    ui.arm.closest('.armrow').classList.toggle('live', on);
    logLine(on ? 'buys ARMED' : 'buys disarmed', on ? 'hit' : undefined);
  });

  ui.adminKey.value = localStorage.getItem('dvd_admin_key') || '';
  ui.adminKey.addEventListener('change', () => {
    localStorage.setItem('dvd_admin_key', ui.adminKey.value.trim());
  });

  ui.testCorner.addEventListener('click', () => {
    state.cornerArmed = true;
    tryAimAtCorner(Math.abs(state.vx) > Math.abs(state.vy));
    logLine('corner forced — incoming…');
  });

  ui.testBuy.addEventListener('click', () => {
    if (!ui.arm.checked) { logLine('arm buys first (checkbox above)', 'err'); return; }
    triggerBuy();
  });

  ui.panelToggle.addEventListener('click', () => ui.panel.classList.toggle('hidden'));

  // ---------- server config ----------
  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      const cfg = await res.json();
      state.buyAmountSol = cfg.buyAmountSol;
      if (cfg.liveReady) {
        ui.serverStatus.textContent =
          `LIVE — ${cfg.buyAmountSol} SOL buy per corner · mint ${cfg.mint.slice(0, 4)}…${cfg.mint.slice(-4)} · cooldown ${cfg.cooldownSeconds}s`;
        ui.serverStatus.className = 'status live';
      } else {
        const missing = [];
        if (!cfg.walletConfigured) missing.push('DEV_WALLET_SECRET_KEY');
        if (!cfg.mint) missing.push('TOKEN_MINT');
        if (!cfg.adminKeyRequired) missing.push('ADMIN_KEY');
        let text;
        if (cfg.walletConfigured && !cfg.walletValid) {
          text = 'DRY RUN — DEV_WALLET_SECRET_KEY is set but cannot be parsed (base58 or JSON array expected)';
        } else if (missing.length) {
          text = `DRY RUN — buys simulated. To go live set: ${missing.join(', ')}`;
        } else {
          text = 'DRY RUN mode (DRY_RUN=true) — buys are simulated';
        }
        ui.serverStatus.textContent = text;
        ui.serverStatus.className = 'status dry';
      }
    } catch {
      ui.serverStatus.textContent = 'no server API found — running as pure screensaver (deploy to Vercel for buys)';
      ui.serverStatus.className = 'status dry';
    }
  }

  // ---------- boot ----------
  resize();
  // Firefox restores form state across reloads — always boot disarmed and
  // read the sliders' actual positions into state instead of trusting defaults.
  ui.arm.checked = false;
  applySpeed();
  applySize();
  applyOdds();
  state.x = Math.random() * Math.max(1, canvas.width - state.logoW);
  state.y = Math.random() * Math.max(1, canvas.height - state.logoH);
  loadConfig();
  logLine('screensaver online. drag the rarity slider — it applies instantly.');
  requestAnimationFrame(frame);
})();
