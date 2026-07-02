// Diagnostic: load the heavy deps lazily so any import-time crash becomes a
// catchable, reportable error instead of FUNCTION_INVOCATION_FAILED.
export default async function handler(req, res) {
  const report = { ok: true, node: process.version };
  try {
    const bs58 = (await import('bs58')).default;
    report.bs58 = typeof bs58.decode;
  } catch (err) {
    report.ok = false;
    report.bs58Error = String((err && err.stack) || err).slice(0, 800);
  }
  try {
    const { Keypair } = await import('@solana/web3.js');
    report.web3 = Keypair.generate().publicKey.toBase58().slice(0, 6);
  } catch (err) {
    report.ok = false;
    report.web3Error = String((err && err.stack) || err).slice(0, 800);
  }
  res.status(200).json(report);
}
