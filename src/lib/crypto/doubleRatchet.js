/**
 * Double Ratchet — Per-message forward secrecy algorithm
 *
 * Implements the Signal Protocol's Double Ratchet using react-native-quick-crypto.
 * After X3DH establishes the initial shared secret, the Double Ratchet provides:
 *   - Forward secrecy: compromising current keys doesn't reveal past messages
 *   - Post-compromise security: new DH ratchet steps heal after compromise
 *   - Out-of-order message handling via stored skipped message keys
 *
 * Architecture Doc Reference: Sections 3, 5, 7
 */
import QuickCrypto from 'react-native-quick-crypto';
import { Buffer } from 'buffer';
import { kdfChainStep, kdfRootStep } from './hkdf';

const CURVE = 'P-256';
const MAX_SKIP = 100;  // Max messages we'll skip ahead in a chain

// ─────────────────────── DH Ratchet Keys ───────────────────────

async function generateDHPair() {
  return await QuickCrypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: CURVE },
    true,
    ['deriveKey', 'deriveBits']
  );
}

async function dhSharedSecret(myPrivateKey, theirPublicKey) {
  const bits = await QuickCrypto.subtle.deriveBits(
    { name: 'ECDH', public: theirPublicKey },
    myPrivateKey,
    256
  );
  return Buffer.from(bits);
}

async function exportPubKey(publicKey) {
  const raw = await QuickCrypto.subtle.exportKey('raw', publicKey);
  return Buffer.from(raw).toString('base64');
}

async function importPubKey(b64) {
  const raw = Buffer.from(b64, 'base64');
  return await QuickCrypto.subtle.importKey(
    'raw', raw,
    { name: 'ECDH', namedCurve: CURVE },
    true, []
  );
}

// ─────────────────────── AES-256-GCM ───────────────────────

/**
 * Encrypt plaintext with a 32-byte message key using AES-256-GCM.
 * @param {Buffer} messageKey
 * @param {string} plaintext
 * @returns {{ iv: string, ct: string }}
 */
export function aesEncrypt(messageKey, plaintext) {
  const iv = QuickCrypto.randomBytes(12);
  const cipher = QuickCrypto.createCipheriv('aes-256-gcm', messageKey, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: Buffer.from(iv).toString('base64'),
    ct: Buffer.concat([enc, tag]).toString('base64'),
  };
}

/**
 * Decrypt ciphertext with a 32-byte message key using AES-256-GCM.
 * @param {Buffer} messageKey
 * @param {string} ivB64
 * @param {string} ctB64
 * @returns {string} plaintext
 */
export function aesDecrypt(messageKey, ivB64, ctB64) {
  const iv = Buffer.from(ivB64, 'base64');
  const ctWithTag = Buffer.from(ctB64, 'base64');
  const tagLength = 16;
  const ct = ctWithTag.subarray(0, ctWithTag.length - tagLength);
  const tag = ctWithTag.subarray(ctWithTag.length - tagLength);
  const decipher = QuickCrypto.createDecipheriv('aes-256-gcm', messageKey, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString('utf8');
}

// ─────────────────────── Session State ───────────────────────

/**
 * @typedef {object} RatchetSession
 * @property {Buffer} rootKey — current root key
 * @property {object} dhSelf — our current DH ratchet keypair { privateKey, publicKey }
 * @property {string} dhSelfPub — base64 of our current DH ratchet public key
 * @property {CryptoKey|null} dhRemote — their current DH ratchet public key
 * @property {string|null} dhRemotePub — base64 of their current DH ratchet public key
 * @property {Buffer|null} sendChainKey — current sending chain key
 * @property {Buffer|null} recvChainKey — current receiving chain key
 * @property {number} sendN — number of messages sent in current sending chain
 * @property {number} recvN — number of messages received in current receiving chain
 * @property {number} prevSendN — number of messages in previous sending chain (for header)
 * @property {Map<string, Buffer>} skippedKeys — stored skipped message keys: "dhPub:n" -> messageKey
 */

/**
 * Initialize a Double Ratchet session after X3DH.
 *
 * @param {Buffer} sharedSecret — 32-byte shared secret from X3DH
 * @param {boolean} isInitiator — true if we initiated the X3DH (Alice)
 * @param {string|null} remoteRatchetPub — Bob's initial ratchet public key (base64)
 *                                          (only needed if isInitiator=true)
 * @returns {Promise<RatchetSession>}
 */
export async function initSession(sharedSecret, isInitiator, remoteRatchetPub = null) {
  const dhSelf = await generateDHPair();
  const dhSelfPub = await exportPubKey(dhSelf.publicKey);

  const session = {
    rootKey: sharedSecret,
    dhSelf,
    dhSelfPub,
    dhRemote: null,
    dhRemotePub: null,
    sendChainKey: null,
    recvChainKey: null,
    sendN: 0,
    recvN: 0,
    prevSendN: 0,
    skippedKeys: new Map(),
  };

  if (isInitiator && remoteRatchetPub) {
    // Alice: perform the first DH ratchet step immediately
    session.dhRemote = await importPubKey(remoteRatchetPub);
    session.dhRemotePub = remoteRatchetPub;
    const dhOut = await dhSharedSecret(session.dhSelf.privateKey, session.dhRemote);
    const { rootKey, chainKey } = kdfRootStep(session.rootKey, dhOut);
    session.rootKey = rootKey;
    session.sendChainKey = chainKey;
  } else if (!isInitiator) {
    // Bob: set the receiving chain from the shared secret directly
    // The first DH ratchet step will happen when we receive Alice's first message
    session.recvChainKey = null; // Will be set on first ratchetDecrypt
  }

  return session;
}

/**
 * Encrypt a plaintext message using the Double Ratchet.
 *
 * @param {RatchetSession} session — mutated in place
 * @param {string} plaintext
 * @returns {Promise<{ header: object, iv: string, ct: string }>}
 */
export async function ratchetEncrypt(session, plaintext) {
  // If we don't have a sending chain yet (responder's first message),
  // perform a DH ratchet step
  if (!session.sendChainKey) {
    // Generate new DH keypair
    session.dhSelf = await generateDHPair();
    session.dhSelfPub = await exportPubKey(session.dhSelf.publicKey);

    if (session.dhRemote) {
      const dhOut = await dhSharedSecret(session.dhSelf.privateKey, session.dhRemote);
      const { rootKey, chainKey } = kdfRootStep(session.rootKey, dhOut);
      session.rootKey = rootKey;
      session.sendChainKey = chainKey;
    } else {
      // Fallback: derive from root key directly (shouldn't happen in normal flow)
      session.sendChainKey = session.rootKey;
    }
    session.sendN = 0;
    session.prevSendN = 0;
  }

  // Symmetric ratchet step: advance the sending chain
  const { chainKey: newCK, messageKey } = kdfChainStep(session.sendChainKey);
  session.sendChainKey = newCK;

  // Encrypt
  const { iv, ct } = aesEncrypt(messageKey, plaintext);

  // Build header
  const header = {
    dh: session.dhSelfPub,      // our current ratchet public key
    n: session.sendN,            // message number in this chain
    pn: session.prevSendN,       // previous chain length (for skip detection)
  };

  session.sendN++;

  return { header, iv, ct };
}

/**
 * Decrypt a received message using the Double Ratchet.
 *
 * @param {RatchetSession} session — mutated in place
 * @param {{ dh: string, n: number, pn: number }} header
 * @param {string} ivB64
 * @param {string} ctB64
 * @returns {Promise<string>} plaintext
 */
export async function ratchetDecrypt(session, header, ivB64, ctB64) {
  const { dh: senderDHPub, n: msgNum, pn: prevN } = header;

  // 1. Check if this message key was previously skipped and stored
  const skipKey = `${senderDHPub}:${msgNum}`;
  if (session.skippedKeys.has(skipKey)) {
    const mk = session.skippedKeys.get(skipKey);
    session.skippedKeys.delete(skipKey);
    return aesDecrypt(mk, ivB64, ctB64);
  }

  // 2. Check if we need a DH ratchet step (sender has a new ratchet key)
  if (senderDHPub !== session.dhRemotePub) {
    // Skip any remaining messages in the current receiving chain
    if (session.recvChainKey) {
      await _skipMessages(session, session.dhRemotePub, prevN);
    }

    // DH ratchet step: update receiving chain
    session.dhRemote = await importPubKey(senderDHPub);
    session.dhRemotePub = senderDHPub;

    const dhRecv = await dhSharedSecret(session.dhSelf.privateKey, session.dhRemote);
    const recvStep = kdfRootStep(session.rootKey, dhRecv);
    session.rootKey = recvStep.rootKey;
    session.recvChainKey = recvStep.chainKey;
    session.recvN = 0;

    // Generate new DH keypair for our next sending chain
    session.prevSendN = session.sendN;
    session.dhSelf = await generateDHPair();
    session.dhSelfPub = await exportPubKey(session.dhSelf.publicKey);

    const dhSend = await dhSharedSecret(session.dhSelf.privateKey, session.dhRemote);
    const sendStep = kdfRootStep(session.rootKey, dhSend);
    session.rootKey = sendStep.rootKey;
    session.sendChainKey = sendStep.chainKey;
    session.sendN = 0;
  }

  // 3. Skip ahead if there are missing messages in the current chain
  await _skipMessages(session, senderDHPub, msgNum);

  // 4. Symmetric ratchet step on receiving chain
  const { chainKey: newCK, messageKey } = kdfChainStep(session.recvChainKey);
  session.recvChainKey = newCK;
  session.recvN++;

  // 5. Decrypt
  return aesDecrypt(messageKey, ivB64, ctB64);
}

/**
 * Skip ahead in the receiving chain and store skipped message keys.
 */
async function _skipMessages(session, dhPub, until) {
  if (!session.recvChainKey) return;

  if (until - session.recvN > MAX_SKIP) {
    throw new Error('Double Ratchet: too many skipped messages');
  }

  while (session.recvN < until) {
    const { chainKey: newCK, messageKey } = kdfChainStep(session.recvChainKey);
    session.recvChainKey = newCK;
    session.skippedKeys.set(`${dhPub}:${session.recvN}`, messageKey);
    session.recvN++;

    // Limit stored skipped keys to prevent memory exhaustion
    if (session.skippedKeys.size > MAX_SKIP * 2) {
      const oldest = session.skippedKeys.keys().next().value;
      session.skippedKeys.delete(oldest);
    }
  }
}

/**
 * Get the current ratchet public key (for inclusion in pre-key bundle or initial message).
 * @param {RatchetSession} session
 * @returns {string} base64 public key
 */
export function getRatchetPublicKey(session) {
  return session.dhSelfPub;
}

/**
 * Check if a session has been established.
 * @param {RatchetSession} session
 * @returns {boolean}
 */
export function isSessionActive(session) {
  return session && session.rootKey != null;
}

/**
 * Export session state for persistence (no CryptoKey objects — only serializable data).
 * @param {RatchetSession} session
 * @returns {Promise<object>}
 */
export async function exportSession(session) {
  if (!session) return null;

  const dhSelfPrivJwk = await QuickCrypto.subtle.exportKey('jwk', session.dhSelf.privateKey);
  const dhSelfPubJwk = await QuickCrypto.subtle.exportKey('jwk', session.dhSelf.publicKey);

  let dhRemotePubRaw = null;
  if (session.dhRemote) {
    dhRemotePubRaw = session.dhRemotePub;
  }

  const skipped = {};
  for (const [key, mk] of session.skippedKeys) {
    skipped[key] = mk.toString('base64');
  }

  return {
    rootKey: session.rootKey.toString('base64'),
    dhSelfPriv: dhSelfPrivJwk,
    dhSelfPub: dhSelfPubJwk,
    dhSelfPubB64: session.dhSelfPub,
    dhRemotePub: dhRemotePubRaw,
    sendChainKey: session.sendChainKey?.toString('base64') || null,
    recvChainKey: session.recvChainKey?.toString('base64') || null,
    sendN: session.sendN,
    recvN: session.recvN,
    prevSendN: session.prevSendN,
    skippedKeys: skipped,
  };
}

/**
 * Import session state from persistence.
 * @param {object} data
 * @returns {Promise<RatchetSession>}
 */
export async function importSession(data) {
  if (!data) return null;

  const dhSelfPriv = await QuickCrypto.subtle.importKey(
    'jwk', data.dhSelfPriv,
    { name: 'ECDH', namedCurve: CURVE }, true, ['deriveKey', 'deriveBits']
  );
  const dhSelfPub = await QuickCrypto.subtle.importKey(
    'jwk', data.dhSelfPub,
    { name: 'ECDH', namedCurve: CURVE }, true, []
  );

  let dhRemote = null;
  if (data.dhRemotePub) {
    dhRemote = await importPubKey(data.dhRemotePub);
  }

  const skippedKeys = new Map();
  if (data.skippedKeys) {
    for (const [key, mkB64] of Object.entries(data.skippedKeys)) {
      skippedKeys.set(key, Buffer.from(mkB64, 'base64'));
    }
  }

  return {
    rootKey: Buffer.from(data.rootKey, 'base64'),
    dhSelf: { privateKey: dhSelfPriv, publicKey: dhSelfPub },
    dhSelfPub: data.dhSelfPubB64,
    dhRemote,
    dhRemotePub: data.dhRemotePub,
    sendChainKey: data.sendChainKey ? Buffer.from(data.sendChainKey, 'base64') : null,
    recvChainKey: data.recvChainKey ? Buffer.from(data.recvChainKey, 'base64') : null,
    sendN: data.sendN || 0,
    recvN: data.recvN || 0,
    prevSendN: data.prevSendN || 0,
    skippedKeys,
  };
}
