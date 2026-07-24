/**
 * HKDF-SHA256 — HMAC-based Key Derivation Function (RFC 5869)
 *
 * Built from QuickCrypto's createHmac. Used by both X3DH (for deriving
 * the initial shared secret) and Double Ratchet (for KDF chain steps).
 *
 * Architecture Doc Reference: Section 3 (X3DH key derivation), Section 7
 */
import QuickCrypto from 'react-native-quick-crypto';
import { Buffer } from 'buffer';

/**
 * HKDF-Extract: Extract a pseudorandom key from input keying material.
 * @param {Buffer} salt — optional salt (if null, uses zero-filled buffer)
 * @param {Buffer} ikm — input keying material
 * @returns {Buffer} pseudorandom key (PRK), 32 bytes for SHA-256
 */
export function hkdfExtract(salt, ikm) {
  if (!salt || salt.length === 0) {
    salt = Buffer.alloc(32, 0); // HashLen zeros for SHA-256
  }
  const hmac = QuickCrypto.createHmac('sha256', salt);
  hmac.update(ikm);
  return Buffer.from(hmac.digest());
}

/**
 * HKDF-Expand: Expand a PRK into output keying material of desired length.
 * @param {Buffer} prk — pseudorandom key from Extract
 * @param {Buffer} info — optional context/application-specific info
 * @param {number} length — desired output length in bytes (max 255 * 32 = 8160)
 * @returns {Buffer} output keying material
 */
export function hkdfExpand(prk, info, length) {
  if (!info) info = Buffer.alloc(0);
  const hashLen = 32; // SHA-256
  const n = Math.ceil(length / hashLen);
  if (n > 255) throw new Error('HKDF-Expand: output too long');

  const okm = [];
  let prev = Buffer.alloc(0);

  for (let i = 1; i <= n; i++) {
    const hmac = QuickCrypto.createHmac('sha256', prk);
    hmac.update(Buffer.concat([prev, info, Buffer.from([i])]));
    prev = Buffer.from(hmac.digest());
    okm.push(prev);
  }

  return Buffer.concat(okm).subarray(0, length);
}

/**
 * Full HKDF: Extract-then-Expand.
 * @param {Buffer} ikm — input keying material
 * @param {Buffer} salt — optional salt
 * @param {Buffer} info — optional context info
 * @param {number} length — desired output length
 * @returns {Buffer}
 */
export function hkdf(ikm, salt, info, length) {
  const prk = hkdfExtract(salt, ikm);
  return hkdfExpand(prk, info, length);
}

/**
 * KDF chain step used by the Double Ratchet.
 * Takes a chain key and returns (new chain key, message key).
 * @param {Buffer} chainKey — 32-byte chain key
 * @returns {{ chainKey: Buffer, messageKey: Buffer }}
 */
export function kdfChainStep(chainKey) {
  // Signal spec: CK_new = HMAC(CK, 0x02), MK = HMAC(CK, 0x01)
  const hmacMk = QuickCrypto.createHmac('sha256', chainKey);
  hmacMk.update(Buffer.from([0x01]));
  const messageKey = Buffer.from(hmacMk.digest());

  const hmacCk = QuickCrypto.createHmac('sha256', chainKey);
  hmacCk.update(Buffer.from([0x02]));
  const newChainKey = Buffer.from(hmacCk.digest());

  return { chainKey: newChainKey, messageKey };
}

/**
 * KDF root key step used by the Double Ratchet DH ratchet.
 * Takes a root key and DH output, returns (new root key, new chain key).
 * @param {Buffer} rootKey — 32-byte root key
 * @param {Buffer} dhOutput — shared secret from DH ratchet step
 * @returns {{ rootKey: Buffer, chainKey: Buffer }}
 */
export function kdfRootStep(rootKey, dhOutput) {
  const derived = hkdf(dhOutput, rootKey, Buffer.from('DeplatformedRatchet'), 64);
  return {
    rootKey: derived.subarray(0, 32),
    chainKey: derived.subarray(32, 64),
  };
}
