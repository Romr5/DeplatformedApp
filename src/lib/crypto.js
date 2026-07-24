/**
 * Crypto — Public API Surface
 *
 * Delegates to the X3DH, Double Ratchet, and SessionStore modules.
 * This is the ONLY crypto module that AppContext and screens should import.
 *
 * Upgrade from v1: replaces single static ECDH key per peer with
 * X3DH initial key agreement + Double Ratchet per-message forward secrecy.
 *
 * Architecture Doc Reference: Sections 2, 3, 5, 7
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Buffer } from 'buffer';
import {
  generateIdentity, getPreKeyBundle, x3dhInitiate, x3dhRespond,
  replenishOneTimeKeys, exportIdentity, importIdentity,
  importPub, computeDH,
} from './crypto/x3dh';
import {
  initSession, ratchetEncrypt as _ratchetEncrypt, ratchetDecrypt as _ratchetDecrypt,
  getRatchetPublicKey, aesEncrypt, aesDecrypt,
} from './crypto/doubleRatchet';
import {
  saveIdentity, loadIdentity, clearIdentity,
  saveSession, loadSession, deleteSession, hasSession as _hasSession,
  getSessionPeerIds, clearAllSessions,
} from './crypto/sessionStore';
import { hkdf } from './crypto/hkdf';

// ─────────────────── Module State ───────────────────

let identity = null;           // X3DH identity (IK + SPK + OPKs)
const sessions = new Map();    // peerId -> RatchetSession (in-memory cache)
const peerPublicKeys = new Map(); // peerId/UUID -> base64 public key
const ecdhSecrets = new Map();     // peerPubKeyB64 -> 32-byte Buffer key
const STORE_PEER_PUBKEYS = '@dp_peer_pubkeys';

// ─────────────────── Initialization ───────────────────

/**
 * Initialize crypto: generate or load X3DH identity.
 * Call once during app startup.
 */
export async function initCrypto() {
  // Try to load existing identity from storage
  identity = await loadIdentity();

  if (!identity) {
    // First run: generate new identity
    console.log('[Crypto] Generating new X3DH identity...');
    identity = await generateIdentity(10);
    await saveIdentity(identity);
    console.log('[Crypto] Identity generated and saved');
  } else {
    console.log('[Crypto] Loaded existing identity');
    // Replenish OPKs if running low
    if (identity.oneTimeKeys.length < 5) {
      await replenishOneTimeKeys(identity, 5);
      await saveIdentity(identity);
    }
  }

  // Load cached peer public keys
  try {
    const raw = await AsyncStorage.getItem(STORE_PEER_PUBKEYS);
    if (raw) {
      const entries = JSON.parse(raw);
      for (const [k, v] of entries) {
        if (k && v) peerPublicKeys.set(k, v);
      }
    }
  } catch {}
}

/**
 * Register a peer's public key (identity key) for direct ECDH.
 * @param {string} peerIdOrUUID
 * @param {string} pubKeyB64
 */
export async function setPeerPublicKey(peerIdOrUUID, pubKeyB64) {
  if (!peerIdOrUUID || !pubKeyB64) return;
  peerPublicKeys.set(peerIdOrUUID, pubKeyB64);
  try {
    const raw = await AsyncStorage.getItem(STORE_PEER_PUBKEYS);
    const map = new Map(JSON.parse(raw || '[]'));
    map.set(peerIdOrUUID, pubKeyB64);
    await AsyncStorage.setItem(STORE_PEER_PUBKEYS, JSON.stringify([...map.entries()]));
  } catch {}
}

/**
 * Get a registered public key for a peer.
 * @param {string} peerIdOrUUID
 * @returns {string|null}
 */
export function getPeerPublicKey(peerIdOrUUID) {
  return peerPublicKeys.get(peerIdOrUUID) || null;
}

/**
 * Derive a deterministic 32-byte shared AES key using ECDH with peer's public key.
 * @param {string} peerPubKeyB64
 * @returns {Promise<Buffer|null>}
 */
export async function getDirectSharedSecret(peerPubKeyB64) {
  if (!identity?.identityKey?.privateKey || !peerPubKeyB64) return null;
  if (ecdhSecrets.has(peerPubKeyB64)) return ecdhSecrets.get(peerPubKeyB64);

  try {
    const peerKey = await importPub(peerPubKeyB64);
    const dhBits = await computeDH(identity.identityKey.privateKey, peerKey);
    const secret = hkdf(dhBits, null, Buffer.from('DeplatformedDirectECDH'), 32);
    ecdhSecrets.set(peerPubKeyB64, secret);
    return secret;
  } catch (e) {
    console.warn('[Crypto] deriveDirectSharedSecret failed:', e);
    return null;
  }
}

/**
 * Encrypt plaintext with direct ECDH shared secret (AES-256-GCM).
 */
export async function encryptDirect(peerIdOrPubKey, plaintext) {
  const pubKey = peerPublicKeys.get(peerIdOrPubKey) || peerIdOrPubKey;
  const key = await getDirectSharedSecret(pubKey);
  if (!key) return null;
  return aesEncrypt(key, plaintext);
}

/**
 * Decrypt ciphertext with direct ECDH shared secret (AES-256-GCM).
 */
export async function decryptDirect(peerIdOrPubKey, ivB64, ctB64) {
  const pubKey = peerPublicKeys.get(peerIdOrPubKey) || peerIdOrPubKey;
  const key = await getDirectSharedSecret(pubKey);
  if (!key) return null;
  try {
    return aesDecrypt(key, ivB64, ctB64);
  } catch (e) {
    return null;
  }
}

/**
 * Export the public identity key as base64.
 * @returns {string}
 */
export function exportPublicKey() {
  return identity?.identityPub || '';
}

/**
 * Get the pre-key bundle for advertising to other devices.
 * Sent in KEY_BUNDLE messages so peers can initiate X3DH.
 * @returns {object|null}
 */
export function getMyPreKeyBundle() {
  if (!identity) return null;
  return getPreKeyBundle(identity);
}

// ─────────────────── X3DH Pairing ───────────────────

/**
 * Initiate X3DH key agreement with a peer (we are Alice).
 * Called when WE send a connect request to a peer.
 *
 * @param {string} peerId — peer endpoint ID
 * @param {object} peerBundle — peer's pre-key bundle
 * @returns {Promise<{ ephemeralPub: string, usedOPKId: number|null }>}
 */
export async function performX3DHInitiate(peerId, peerBundle, initialRatchetPub = null) {
  if (peerBundle?.identityKey) {
    await setPeerPublicKey(peerId, peerBundle.identityKey);
  }

  const { sharedSecret, ephemeralPub, usedOPKId } = await x3dhInitiate(identity, peerBundle);

  // Initialize Double Ratchet session as initiator
  // Use peer's ratchet public key from response if present, else their signed pre-key
  const remoteRatchetKey = initialRatchetPub || peerBundle?.signedPreKey;
  const session = await initSession(sharedSecret, true, remoteRatchetKey);
  sessions.set(peerId, session);
  await saveSession(peerId, session);

  console.log(`[Crypto] X3DH initiated with ${peerId}`);
  return { ephemeralPub, usedOPKId };
}

/**
 * Respond to an X3DH key agreement (we are Bob).
 * Called when WE accept a connect request from a peer.
 *
 * @param {string} peerId — peer endpoint ID
 * @param {object} initiatorData — { identityKey, ephemeralKey, usedOPKId }
 * @returns {Promise<string>} our ratchet public key to send back
 */
export async function performX3DHRespond(peerId, initiatorData) {
  if (initiatorData?.identityKey) {
    await setPeerPublicKey(peerId, initiatorData.identityKey);
  }

  const sharedSecret = await x3dhRespond(identity, initiatorData);

  // Initialize Double Ratchet session as responder
  const session = await initSession(sharedSecret, false);
  sessions.set(peerId, session);
  await saveSession(peerId, session);

  // Save identity (OPK may have been consumed)
  await saveIdentity(identity);

  console.log(`[Crypto] X3DH responded to ${peerId}`);
  return getRatchetPublicKey(session);
}

// ─────────────────── Hybrid Double Ratchet + Direct ECDH ───────────────────

/**
 * Encrypt a message for a peer.
 * Attempts Double Ratchet first; automatically falls back to Direct ECDH (AES-256-GCM).
 *
 * @param {string} peerId
 * @param {string} plaintext
 * @param {string|null} peerPubKey
 * @returns {Promise<{ header?: object, iv: string, ct: string }|null>}
 */
export async function encrypt(peerId, plaintext, peerPubKey = null) {
  if (peerPubKey) {
    await setPeerPublicKey(peerId, peerPubKey);
  }

  // 1. Direct ECDH (ECDH P-256 + AES-256-GCM authenticated encryption)
  // Deterministic, zero-state desync, impervious to dropped packets or restart orders
  const direct = await encryptDirect(peerId, plaintext);
  if (direct) {
    return { iv: direct.iv, ct: direct.ct };
  }

  if (peerPubKey) {
    const directFromPub = await encryptDirect(peerPubKey, plaintext);
    if (directFromPub) return { iv: directFromPub.iv, ct: directFromPub.ct };
  }

  // 2. Ratchet attempt if session exists
  const session = await _getSession(peerId);
  if (session && session.dhRemote) {
    try {
      const result = await _ratchetEncrypt(session, plaintext);
      await saveSession(peerId, session);
      return result;
    } catch (e) {
      console.warn(`[Crypto] Ratchet encrypt failed for ${peerId}:`, e);
    }
  }

  return null;
}

/**
 * Decrypt a message from a peer.
 * Attempts Direct ECDH first, with Double Ratchet fallback if header is present.
 *
 * @param {string} peerId
 * @param {{ dh: string, n: number, pn: number }|null} header
 * @param {string} ivB64
 * @param {string} ctB64
 * @param {string|null} peerPubKey
 * @returns {Promise<string|null>}
 */
export async function decrypt(peerId, header, ivB64, ctB64, peerPubKey = null) {
  if (peerPubKey) {
    await setPeerPublicKey(peerId, peerPubKey);
  }

  // 1. Direct ECDH decrypt (fast, stateless, 100% reliable)
  const direct = await decryptDirect(peerId, ivB64, ctB64);
  if (direct) return direct;

  if (peerPubKey) {
    const directFromPub = await decryptDirect(peerPubKey, ivB64, ctB64);
    if (directFromPub) return directFromPub;
  }

  // 2. Double Ratchet decrypt if header is present
  if (header) {
    const session = await _getSession(peerId);
    if (session) {
      try {
        const plaintext = await _ratchetDecrypt(session, header, ivB64, ctB64);
        await saveSession(peerId, session);
        return plaintext;
      } catch (e) {
        console.warn(`[Crypto] Ratchet decrypt failed for ${peerId}:`, e);
      }
    }
  }

  return null;
}

// ─────────────────── Session Management ───────────────────

/**
 * Check if we have an active session (pairing) with a peer.
 * @param {string} peerId
 * @returns {Promise<boolean>}
 */
export async function hasSession(peerId) {
  if (sessions.has(peerId)) return true;
  return await _hasSession(peerId);
}

/**
 * Link a session to a secondary identifier (such as permanent device UUID).
 * @param {string} peerId
 * @param {string} uuid
 */
export async function linkSessionUUID(peerId, uuid) {
  if (!uuid || uuid === peerId) return;
  const session = await _getSession(peerId);
  if (session) {
    sessions.set(uuid, session);
    await saveSession(uuid, session);
    console.log(`[Crypto] Linked session from ${peerId} to UUID ${uuid}`);
  }
}

/**
 * Revoke pairing with a peer — deletes the session key.
 * @param {string} peerId
 */
export async function revokeSession(peerId) {
  sessions.delete(peerId);
  await deleteSession(peerId);
  console.log(`[Crypto] Session revoked for ${peerId}`);
}

/**
 * Get all peer IDs we have active sessions with.
 * @returns {Promise<string[]>}
 */
export async function getActivePeerIds() {
  return await getSessionPeerIds();
}

/**
 * Full crypto reset — clear identity and all sessions.
 */
export async function resetCrypto() {
  identity = null;
  sessions.clear();
  await clearIdentity();
  await clearAllSessions();
  console.log('[Crypto] Full crypto reset complete');
}

/**
 * Get a fingerprint of our identity key for verification.
 * @returns {string}
 */
export function fingerprint() {
  if (!identity) return '';
  return identity.identityPub.slice(0, 32) + '…';
}

// ─────────────────── Legacy Compat ───────────────────

/**
 * Legacy compatibility: check if we have a shared secret with a peer.
 * Maps to hasSession() for backward compatibility with v1 code.
 * @param {string} peerId
 * @returns {boolean} synchronous check (in-memory cache only)
 */
export function hasSecret(peerId) {
  return sessions.has(peerId);
}

// ─────────────────── Helpers ───────────────────

/**
 * Get or load a session for a peer.
 * @param {string} peerId
 * @returns {Promise<import('./crypto/doubleRatchet').RatchetSession|null>}
 */
async function _getSession(peerId) {
  if (sessions.has(peerId)) return sessions.get(peerId);

  const loaded = await loadSession(peerId);
  if (loaded) {
    sessions.set(peerId, loaded);
    return loaded;
  }

  return null;
}
