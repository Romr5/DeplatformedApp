/**
 * GroupCrypto — Sender Key encryption for group rooms.
 *
 * Each room has a shared sender key (AES-256) that all members use.
 * When a member is removed, the key is rotated and redistributed
 * to remaining members only (forward secrecy for membership changes).
 *
 * Sender keys are distributed via the existing 1:1 encrypted session
 * (Double Ratchet), so only paired members can receive them.
 *
 * Architecture Doc Reference: Section 10
 */
import QuickCrypto from 'react-native-quick-crypto';
import { Buffer } from 'buffer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { encrypt as sessionEncrypt, decrypt as sessionDecrypt, exportPublicKey } from '../crypto';
import { sendMessage } from '../p2p';

const STORE_SENDER_KEYS = '@dp_group_sender_keys';

// In-memory cache: roomId -> { key: Buffer, version: number }
const senderKeys = new Map();

// ─────────────────── Sender Key Management ───────────────────

/**
 * Generate a new random sender key for a room.
 * @param {string} roomId
 * @returns {Promise<{ key: Buffer, version: number }>}
 */
export async function generateSenderKey(roomId) {
  const key = Buffer.from(QuickCrypto.randomBytes(32));
  const existing = senderKeys.get(roomId);
  const version = existing ? existing.version + 1 : 1;
  const entry = { key, version };
  senderKeys.set(roomId, entry);
  await _saveSenderKeys();
  console.log(`[GroupCrypto] Generated sender key v${version} for room ${roomId}`);
  return entry;
}

/**
 * Set/receive a sender key for a room (received from another member).
 * @param {string} roomId
 * @param {string} keyB64 — base64 encoded key
 * @param {number} version
 */
export async function setSenderKey(roomId, keyB64, version) {
  senderKeys.set(roomId, { key: Buffer.from(keyB64, 'base64'), version });
  await _saveSenderKeys();
  console.log(`[GroupCrypto] Received sender key v${version} for room ${roomId}`);
}

/**
 * Get the current sender key for a room.
 * @param {string} roomId
 * @returns {{ key: Buffer, version: number }|null}
 */
export function getSenderKey(roomId) {
  return senderKeys.get(roomId) || null;
}

/**
 * Distribute a room's sender key to a specific peer via their 1:1 session.
 * The key is encrypted with the existing Double Ratchet or Direct ECDH session.
 *
 * @param {string} roomId
 * @param {string} peerId — target peer to receive the key
 * @param {string} myId — sender's UUID
 */
export async function distributeSenderKey(roomId, peerId, myId) {
  const entry = senderKeys.get(roomId);
  if (!entry) {
    console.warn(`[GroupCrypto] No sender key for room ${roomId}`);
    return;
  }

  // Encrypt the sender key with the 1:1 session
  const keyPayload = JSON.stringify({
    key: entry.key.toString('base64'),
    version: entry.version,
    roomId,
  });

  const enc = await sessionEncrypt(peerId, keyPayload);
  let myPub = '';
  try {
    myPub = exportPublicKey();
  } catch {}

  if (enc) {
    await sendMessage(peerId, {
      type: 'SENDER_KEY_DIST',
      from: myId,
      pubKey: myPub,
      roomId,
      header: enc.header || null,
      iv: enc.iv,
      ct: enc.ct,
    });
  } else {
    // Fallback: send plaintext key data if no 1:1 session yet
    await sendMessage(peerId, {
      type: 'SENDER_KEY_DIST',
      from: myId,
      pubKey: myPub,
      roomId,
      keyData: keyPayload,
    });
  }
}

/**
 * Handle a received sender key distribution message.
 * @param {string} fromPeerId
 * @param {object} msg
 */
export async function handleSenderKeyDistribution(fromPeerId, msg) {
  let keyPayload = null;

  if (msg.ct && msg.iv) {
    // Decrypt via 1:1 session (supports both Direct ECDH and Double Ratchet)
    let plain = await sessionDecrypt(fromPeerId, msg.header || null, msg.iv, msg.ct, msg.pubKey || null);
    if (!plain && msg.from && msg.from !== fromPeerId) {
      plain = await sessionDecrypt(msg.from, msg.header || null, msg.iv, msg.ct, msg.pubKey || null);
    }
    if (plain) {
      try {
        keyPayload = JSON.parse(plain);
      } catch (e) {
        console.warn('[GroupCrypto] JSON parse error in sender key distribution:', e);
      }
    }
  }

  if (!keyPayload && msg.keyData) {
    try {
      keyPayload = typeof msg.keyData === 'string' ? JSON.parse(msg.keyData) : msg.keyData;
    } catch (e) {
      console.warn('[GroupCrypto] JSON parse error in keyData:', e);
    }
  }

  if (keyPayload && keyPayload.roomId && keyPayload.key) {
    await setSenderKey(keyPayload.roomId, keyPayload.key, keyPayload.version || 1);
    console.log(`[GroupCrypto] Installed sender key for room ${keyPayload.roomId} v${keyPayload.version || 1}`);
  } else {
    console.warn('[GroupCrypto] Failed to decrypt or extract sender key distribution from', fromPeerId);
  }
}

/**
 * Rotate the sender key for a room (used when a member is removed).
 * Generates a new key and redistributes to all remaining members.
 *
 * @param {string} roomId
 * @param {string[]} memberPeerIds — remaining member peer IDs
 * @param {string} myId
 */
export async function rotateSenderKey(roomId, memberPeerIds, myId) {
  const entry = await generateSenderKey(roomId);
  console.log(`[GroupCrypto] Rotating sender key for room ${roomId} to v${entry.version}`);

  for (const peerId of memberPeerIds) {
    await distributeSenderKey(roomId, peerId, myId);
  }
}

// ─────────────────── Encrypt / Decrypt ───────────────────

/**
 * Encrypt a message with the room's sender key.
 * @param {string} roomId
 * @param {string} plaintext
 * @returns {{ iv: string, ct: string, keyVersion: number }|null}
 */
export function encryptWithSenderKey(roomId, plaintext) {
  const entry = senderKeys.get(roomId);
  if (!entry) return null;

  const iv = QuickCrypto.randomBytes(12);
  const cipher = QuickCrypto.createCipheriv('aes-256-gcm', entry.key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: Buffer.from(iv).toString('base64'),
    ct: Buffer.concat([enc, tag]).toString('base64'),
    keyVersion: entry.version,
  };
}

/**
 * Decrypt a message with the room's sender key.
 * @param {string} roomId
 * @param {string} ivB64
 * @param {string} ctB64
 * @returns {string|null}
 */
export function decryptGroupMessage(roomId, ivB64, ctB64) {
  const entry = senderKeys.get(roomId);
  if (!entry) return null;

  try {
    const iv = Buffer.from(ivB64, 'base64');
    const ctWithTag = Buffer.from(ctB64, 'base64');
    const tagLength = 16;
    const ct = ctWithTag.subarray(0, ctWithTag.length - tagLength);
    const tag = ctWithTag.subarray(ctWithTag.length - tagLength);

    const decipher = QuickCrypto.createDecipheriv('aes-256-gcm', entry.key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
    return dec.toString('utf8');
  } catch (e) {
    console.warn('[GroupCrypto] Decrypt failed:', e);
    return null;
  }
}

/**
 * Delete a room's sender key (when leaving).
 * @param {string} roomId
 */
export async function deleteSenderKey(roomId) {
  senderKeys.delete(roomId);
  await _saveSenderKeys();
}

// ─────────────────── Persistence ───────────────────

/**
 * Load all sender keys from storage.
 */
export async function loadSenderKeys() {
  try {
    const raw = await AsyncStorage.getItem(STORE_SENDER_KEYS);
    if (raw) {
      const entries = JSON.parse(raw);
      for (const [roomId, data] of entries) {
        senderKeys.set(roomId, {
          key: Buffer.from(data.key, 'base64'),
          version: data.version,
        });
      }
    }
  } catch {}
}

async function _saveSenderKeys() {
  const entries = [];
  for (const [roomId, data] of senderKeys) {
    entries.push([roomId, { key: data.key.toString('base64'), version: data.version }]);
  }
  await AsyncStorage.setItem(STORE_SENDER_KEYS, JSON.stringify(entries));
}
