/* The bouncing mark: a dripping faucet, drawn to fill an arbitrary w×h box
 * (the sim uses h = w/2). Shared by the viewer canvas and the operator
 * console preview so both render the same thing.
 */

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export function drawFaucet(ctx, x, y, w, h, color, alpha = 1, glow = false) {
  const pipe = h * 0.24;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  if (glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = Math.max(8, h * 0.22);
  }
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';

  // wall flange
  roundRect(ctx, 0, h * 0.1, w * 0.09, h * 0.56, h * 0.06);
  ctx.fill();

  // body: horizontal run bending into the down-turned spout
  ctx.lineWidth = pipe;
  ctx.beginPath();
  ctx.moveTo(w * 0.05, h * 0.34);
  ctx.lineTo(w * 0.55, h * 0.34);
  ctx.quadraticCurveTo(w * 0.87, h * 0.34, w * 0.87, h * 0.6);
  ctx.lineTo(w * 0.87, h * 0.73);
  ctx.stroke();

  // valve stem + lever handle
  ctx.lineWidth = pipe * 0.55;
  ctx.beginPath();
  ctx.moveTo(w * 0.32, h * 0.34);
  ctx.lineTo(w * 0.32, h * 0.18);
  ctx.stroke();
  roundRect(ctx, w * 0.19, h * 0.02, w * 0.27, h * 0.16, h * 0.07);
  ctx.fill();

  // the drip
  const r = h * 0.085;
  const cx = w * 0.87;
  const cy = h * 0.9;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 1.9);
  ctx.bezierCurveTo(cx + r * 0.95, cy - r * 0.5, cx + r, cy + r * 0.5, cx, cy + r);
  ctx.bezierCurveTo(cx - r, cy + r * 0.5, cx - r * 0.95, cy - r * 0.5, cx, cy - r * 1.9);
  ctx.fill();

  ctx.restore();
}
