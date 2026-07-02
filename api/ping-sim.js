// Diagnostic: imports only the shared sim from the repo root.
import { createSim, clampSettings } from '../sim.js';

export default function handler(req, res) {
  const sim = createSim(clampSettings({ seed: 1, epochMs: 0, oddsN: 10, speed: 320, logoW: 240 }));
  sim.advanceTo(60);
  res.status(200).json({ ok: true, corners: sim.cornerCount, bounces: sim.bounceCount });
}
