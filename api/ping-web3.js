// Diagnostic: imports the heavy dependencies only.
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

export default function handler(req, res) {
  const kp = Keypair.generate();
  res.status(200).json({ ok: true, web3: typeof Keypair, bs58: typeof bs58.decode, pub: kp.publicKey.toBase58().slice(0, 6) });
}
