// Diagnostic: no imports at all. If this fails, ESM/runtime itself is broken.
export default function handler(req, res) {
  res.status(200).json({ ok: true, node: process.version, env: process.env.VERCEL_REGION || null });
}
