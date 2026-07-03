/* DVD CORNER BUY — viewer client.
 *
 * The bounce is a deterministic simulation (sim.js) driven by server-issued
 * settings, so every open tab renders the exact same trajectory. Clients poll
 * /api/settings every few seconds; when the version changes everyone rebuilds
 * the sim in lockstep. Corner hits are reported to /api/buy, where the server
 * replays the same physics before spending anything — clients are untrusted
 * spectators. All controls live in the separate admin console (/admin).
 */
import { createSim, clampSettings, ARENA_W, ARENA_H } from './sim.js';

(() => {
  'use strict';

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const el = (id) => document.getElementById(id);
  const ui = {
    captionText: el('captionText'), capCorners: el('capCorners'), capBuy: el('capBuy'),
    flash: el('flash'), banner: el('banner'), osdTime: el('osdTime'),
  };

  const DVD_COLORS = ['#ff8c00', '#ffd700', '#ff0080', '#00ffff', '#ff2d2d',
                      '#3dff3d', '#7cfc00', '#b44dff', '#ff6ec7', '#4d7cff'];
  const POLL_MS = 4000;

  const state = {
    settings: null,
    sim: null,
    skewMs: 0,          // serverTime - local Date.now()
    seenCorners: 0,
    localMode: false,   // no API reachable — free-running screensaver
    lastBuyAt: 0,
    particles: [],
  };

  function serverNowMs() {
    return Date.now() + state.skewMs;
  }

  function rebuildSim(settings) {
    state.settings = settings;
    state.sim = createSim(settings);
    // Fast-forward and swallow corners from before we started watching.
    state.sim.advanceTo((serverNowMs() - settings.epochMs) / 1000);
    state.seenCorners = state.sim.cornerCount;
    ui.captionText.textContent = settings.caption;
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);

  async function poll() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (!data.ok) throw new Error('bad response');
      state.skewMs = data.serverTime - Date.now();
      state.localMode = false;
      // Only ever move forward: without a durable store, a cold Vercel
      // instance can still answer with stale defaults, and flip-flopping
      // between versions makes the logo jump between two trajectories.
      if (!state.settings || data.settings.version > state.settings.version) {
        rebuildSim(clampSettings(data.settings));
      }
      if (data.lastBuy && data.lastBuy.atMs !== state.lastBuyAt) {
        showBuy(data.lastBuy);
      }
    } catch {
      if (!state.settings) {
        state.localMode = true;
        rebuildSim(clampSettings({
          version: 1,
          seed: (Math.random() * 4294967295) >>> 0,
          epochMs: Date.now(),
          oddsN: 100, speed: 320, logoW: 240,
          force: false, buysEnabled: false,
          caption: 'offline screensaver mode',
        }));
      }
    }
  }

  function cornerFx() {
    ui.flash.classList.remove('go'); void ui.flash.offsetWidth; ui.flash.classList.add('go');
    ui.banner.classList.remove('go'); void ui.banner.offsetWidth; ui.banner.classList.add('go');
    const sx = canvas.width / ARENA_W, sy = canvas.height / ARENA_H;
    const pos = state.sim.positionAt((serverNowMs() - state.settings.epochMs) / 1000);
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
    // Spread the stampede: every viewer reports, the server dedupes. The wide
    // jitter usually lets the first report finish before the rest even fire.
    setTimeout(async () => {
      try {
        const res = await fetch('/api/buy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cornerIndex }),
        });
        const data = await res.json().catch(() => ({}));
        if (data.ok && data.signature) showBuy(data);
      } catch { /* another viewer's report will land */ }
    }, Math.random() * 3000);
  }

  function showBuy(buy) {
    state.lastBuyAt = buy.atMs || Date.now();
    ui.capBuy.hidden = false;
    ui.capBuy.href = buy.solscan || `https://solscan.io/tx/${buy.signature}`;
    ui.capBuy.textContent = `⚡ last dev buy: ${buy.amountSol} SOL ↗`;
  }

  const trail = []; // recent logo positions for the neon motion trail

  function drawLogoAt(x, y, w, h, color, alpha, glow) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 24;
    }
    ctx.fillStyle = color;
    ctx.font = `italic 900 ${h * 0.62}px "Arial Black", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DVD', w / 2, h * 0.30);
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.78, w * 0.46, h * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    if (alpha === 1) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.font = `900 ${h * 0.17}px "Arial Black", Arial, sans-serif`;
      ctx.fillText('V I D E O', w / 2, h * 0.79);
    }
    ctx.restore();
  }

  function drawLogo(pos) {
    const sx = canvas.width / ARENA_W, sy = canvas.height / ARENA_H;
    const x = pos.x * sx, y = pos.y * sy, w = pos.w * sx, h = pos.h * sy;
    const color = DVD_COLORS[state.sim.colorIndex % DVD_COLORS.length];

    // sample the trail by distance so its length is speed-independent
    const last = trail[trail.length - 1];
    if (!last || Math.hypot(x - last.x, y - last.y) > 22) {
      trail.push({ x, y, w, h, color });
      if (trail.length > 8) trail.shift();
    }
    for (let i = 0; i < trail.length - 1; i++) {
      const g = trail[i];
      drawLogoAt(g.x, g.y, g.w, g.h, g.color, 0.04 + (i / trail.length) * 0.16, false);
    }
    drawLogoAt(x, y, w, h, color, 1, true);
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

      if (state.sim.cornerCount > state.seenCorners) {
        for (const c of state.sim.corners) {
          if (c.index >= state.seenCorners) {
            cornerFx();
            reportCorner(c.index);
          }
        }
        state.seenCorners = state.sim.cornerCount;
      }
      ui.capCorners.textContent = state.sim.cornerCount;

      // VCR counter: time since this run's epoch, like a playing disc
      if (ui.osdTime) {
        const secs = Math.max(0, Math.floor(tNow));
        const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
        ui.osdTime.textContent = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawLogo(state.sim.positionAt(tNow));
      drawParticles(dt);
    }
    requestAnimationFrame(frame);
  }

  resize();
  poll();
  setInterval(poll, POLL_MS);
  requestAnimationFrame(frame);
})();
