/**
 * ContactManager — Formal Pairing / Trust Layer (Layer 3)
 *
 * Manages the full pairing lifecycle:
 *   1. Send/receive connect requests
 *   2. Accept/reject with X3DH key exchange
 *   3. Trusted peer memory with auto-reconnect
 *   4. Revoke/block paired contacts
 *
 * Architecture Doc Reference: Section 3
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getMyPreKeyBundle, performX3DHInitiate, performX3DHRespond,
  hasSession, revokeSession, linkSessionUUID, setPeerPublicKey,
} from './crypto';
import {
  savePendingRequest, loadPendingRequests, removePendingRequest, clearPendingRequests,
} from './crypto/sessionStore';
import { sendMessage } from './p2p';

const STORE_CONTACTS = '@dp_paired_contacts';
const STORE_BLOCKED  = '@dp_blocked_peers';
const STORE_TRUSTED  = '@deplatformed_trusted_peers';

// ─────────────────── In-Memory State ───────────────────

let localMyId = null;
let localMyAlias = null;
let localMyEmoji = null;
let pairedContacts = new Map(); // peerId -> { alias, emoji, pairedAt, identityKey }
let blockedPeers = new Set();
let trustedPeers = new Set();
let pendingIncoming = [];       // connect requests we haven't accepted/rejected yet
let onPairingComplete = null;   // callback when a pairing completes

// ─────────────────── Initialization ───────────────────

export function setContactManagerMyId(id) {
  if (id) localMyId = id;
}

export function setContactManagerProfile(alias, emoji) {
  if (alias) localMyAlias = alias;
  if (emoji) localMyEmoji = emoji;
}

/**
 * Load persisted contacts, trusted peers, and blocked list.
 */
export async function initContactManager(myId = null, myAlias = null, myEmoji = null) {
  if (myId) localMyId = myId;
  if (myAlias) localMyAlias = myAlias;
  if (myEmoji) localMyEmoji = myEmoji;
  // Load paired contacts
  try {
    const raw = await AsyncStorage.getItem(STORE_CONTACTS);
    if (raw) {
      const list = JSON.parse(raw);
      pairedContacts = new Map(list);
    }
  } catch {}

  // Load trusted peers (legacy compat key)
  try {
    const raw = await AsyncStorage.getItem(STORE_TRUSTED);
    if (raw) {
      trustedPeers = new Set(JSON.parse(raw));
    }
  } catch {}

  // Load blocked peers
  try {
    const raw = await AsyncStorage.getItem(STORE_BLOCKED);
    if (raw) {
      blockedPeers = new Set(JSON.parse(raw));
    }
  } catch {}

  // Load pending requests
  pendingIncoming = await loadPendingRequests();
}

/**
 * Set a callback for when pairing completes.
 * @param {function} callback — (peerId, peerAlias) => void
 */
export function onPaired(callback) {
  onPairingComplete = callback;
}

// ─────────────────── Connect Request Flow (§3.1) ───────────────────

/**
 * Send a connect request to a peer.
 * Includes our pre-key bundle so they can do X3DH immediately on accept.
 *
 * @param {string} peerId — target endpoint ID
 * @param {string} myAlias — our display name
 * @param {string} myEmoji — our emoji
 * @param {string} myId — our UUID
 * @returns {Promise<string>} requestId
 */
export async function sendConnectRequest(peerId, myAlias, myEmoji, myId) {
  if (blockedPeers.has(peerId)) {
    console.log('[ContactManager] Peer is blocked, not sending request');
    return null;
  }

  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const bundle = getMyPreKeyBundle();
  const cleanMyAlias = (myAlias || localMyAlias || 'Peer').replace(/^[\p{Emoji}\s]+/u, '').trim() || myAlias || localMyAlias || 'Peer';
  const cleanMyEmoji = myEmoji || localMyEmoji || '👤';

  await sendMessage(peerId, {
    type: 'CONNECT_REQUEST',
    requestId,
    from: myId || localMyId,
    fromAlias: cleanMyAlias,
    fromEmoji: cleanMyEmoji,
    preKeyBundle: bundle,
  });

  console.log(`[ContactManager] Sent connect request ${requestId} to ${peerId} (${cleanMyAlias})`);
  return requestId;
}

/**
 * Handle an incoming connect request from a peer.
 * Stores it as pending until the user accepts or rejects.
 *
 * @param {string} fromPeerId — sender's endpoint ID
 * @param {object} msg — the CONNECT_REQUEST message
 */
export async function handleConnectRequest(fromPeerId, msg) {
  const rawAlias = msg.fromAlias || msg.alias || 'Nearby Peer';
  const cleanAlias = rawAlias.replace(/^[\p{Emoji}\s]+/u, '').trim() || rawAlias;

  // Drop immediately if sender is blacklisted by endpoint, UUID, or alias
  if (isBlocked(fromPeerId) || (msg.from && isBlocked(msg.from)) || isBlocked(cleanAlias)) {
    console.log('[ContactManager] Dropped connect request from blocked peer:', cleanAlias);
    return;
  }

  const request = {
    requestId: msg.requestId || `req-${Date.now()}`,
    peerId: fromPeerId,
    peerAlias: cleanAlias,
    fromAlias: cleanAlias,
    peerEmoji: msg.fromEmoji || msg.emoji || '📱',
    fromEmoji: msg.fromEmoji || msg.emoji || '📱',
    peerBundle: msg.preKeyBundle,
    peerUUID: msg.from || msg.peerUUID,
    direction: 'incoming',
    ts: Date.now(),
  };

  // If this peer is already trusted, auto-accept
  if (isPeerTrusted(fromPeerId) || isPeerTrusted(cleanAlias) || isPeerTrusted(msg.fromAlias) || (msg.from && isPeerTrusted(msg.from))) {
    console.log('[ContactManager] Auto-accepting trusted peer:', cleanAlias);
    await acceptRequest(request);
    return;
  }

  // Deduplicate: replace any existing pending request from the same peer (by peerId, UUID, or cleanAlias)
  pendingIncoming = pendingIncoming.filter(r => {
    const sameId = r.peerId === fromPeerId;
    const sameUUID = r.peerUUID && msg.from && r.peerUUID === msg.from;
    const sameAlias = cleanAlias && r.peerAlias && r.peerAlias.toLowerCase() === cleanAlias.toLowerCase();
    return !(sameId || sameUUID || sameAlias);
  });

  // Store as pending
  pendingIncoming.push(request);
  await savePendingRequest(request);
}

/**
 * Accept a connect request — performs X3DH key exchange.
 *
 * @param {object} request — pending request object
 */
export async function acceptRequest(request) {
  const { peerId, peerAlias, peerEmoji, peerBundle, peerUUID, requestId } = request;

  // Always remove pending request from UI and storage immediately
  pendingIncoming = pendingIncoming.filter(r => r.requestId !== requestId);
  await removePendingRequest(requestId).catch(() => {});

  try {
    // Register initiator's public key
    if (peerBundle?.identityKey) {
      await setPeerPublicKey(peerId, peerBundle.identityKey);
      if (peerUUID) await setPeerPublicKey(peerUUID, peerBundle.identityKey);
    }

    // Attempt X3DH with graceful fallback to Direct ECDH
    let myRatchetPub = null;
    try {
      myRatchetPub = await performX3DHRespond(peerId, {
        identityKey: peerBundle.identityKey,
        ephemeralKey: peerBundle.signedPreKey,
        usedOPKId: peerBundle.oneTimePreKey?.id ?? null,
      });
    } catch (errX3DH) {
      console.warn('[ContactManager] X3DH respond error, using Direct ECDH:', errX3DH);
    }

    const cleanMyAlias = (localMyAlias || 'Peer').replace(/^[\p{Emoji}\s]+/u, '').trim() || localMyAlias || 'Peer';
    const cleanMyEmoji = localMyEmoji || '👤';

    // Send back our key bundle so the initiator can complete pairing
    const myBundle = getMyPreKeyBundle();
    try {
      await sendMessage(peerId, {
        type: 'X3DH_RESPONSE',
        requestId,
        from: localMyId || peerId,
        fromAlias: cleanMyAlias,
        fromEmoji: cleanMyEmoji,
        pubKey: myBundle?.identityKey,
        preKeyBundle: myBundle,
        ratchetPub: myRatchetPub,
      });
    } catch (errSend) {
      console.warn('[ContactManager] Could not send X3DH_RESPONSE to peer:', errSend);
    }

    const cleanPeerAlias = (peerAlias || '').replace(/^[\p{Emoji}\s]+/u, '').trim() || peerAlias || 'Peer';

    // Save as paired contact
    await _addPairedContact(peerId, {
      alias: cleanPeerAlias,
      emoji: peerEmoji || '📱',
      identityKey: peerBundle?.identityKey,
      pairedAt: Date.now(),
      uuid: peerUUID,
    });

    if (peerUUID) {
      await linkSessionUUID(peerId, peerUUID);
    }

    // Add to trusted peers
    await addTrustedPeer(peerId);
    if (cleanPeerAlias) await addTrustedPeer(cleanPeerAlias);
    if (peerAlias && peerAlias !== cleanPeerAlias) await addTrustedPeer(peerAlias);
    if (peerUUID) await addTrustedPeer(peerUUID);

    // Remove from pending incoming memory & persistent storage
    pendingIncoming = pendingIncoming.filter(r => r.requestId !== requestId);
    if (requestId) {
      await removePendingRequest(requestId);
    }

    // Notify listeners
    if (onPairingComplete) onPairingComplete(peerId, cleanPeerAlias);

    console.log(`[ContactManager] Pairing accepted with ${cleanPeerAlias} (${peerId})`);
  } catch (e) {
    console.warn('[ContactManager] Accept request failed:', e);
  }
}

/**
 * Handle an X3DH response from a peer (we are the initiator, they accepted).
 *
 * @param {string} fromPeerId
 * @param {object} msg — X3DH_RESPONSE message
 */
export async function handleX3DHResponse(fromPeerId, msg) {
  try {
    const peerPubKey = msg.pubKey || msg.preKeyBundle?.identityKey;
    if (peerPubKey) {
      await setPeerPublicKey(fromPeerId, peerPubKey);
      if (msg.from) await setPeerPublicKey(msg.from, peerPubKey);
    }

    // Attempt X3DH initiate with fallback
    try {
      await performX3DHInitiate(fromPeerId, msg.preKeyBundle, msg.ratchetPub);
    } catch (errX3DH) {
      console.warn('[ContactManager] X3DH initiate error, using Direct ECDH:', errX3DH);
    }

    if (msg.from) {
      await linkSessionUUID(fromPeerId, msg.from);
    }

    const rawAlias = msg.fromAlias || msg.alias || 'Peer';
    const cleanAlias = rawAlias.replace(/^[\p{Emoji}\s]+/u, '').trim() || rawAlias;

    // Save as paired contact or refresh endpoint ID on reconnect
    await _addPairedContact(fromPeerId, {
      alias: cleanAlias,
      emoji: msg.fromEmoji || msg.emoji || '📱',
      identityKey: msg.preKeyBundle?.identityKey || peerPubKey,
      pairedAt: Date.now(),
      uuid: msg.from,
    });

    // Add to trusted
    await addTrustedPeer(fromPeerId);
    if (cleanAlias) await addTrustedPeer(cleanAlias);
    if (msg.from) await addTrustedPeer(msg.from);

    // Send mutual PAIR_ACK so both sides are guaranteed to be in sync
    try {
      await sendMessage(fromPeerId, {
        type: 'PAIR_ACK',
        requestId: msg.requestId,
        from: localMyId || fromPeerId,
        fromAlias: localMyAlias || 'Peer',
      });
    } catch (errAck) {
      console.warn('[ContactManager] Could not send PAIR_ACK:', errAck);
    }

    if (onPairingComplete) onPairingComplete(fromPeerId, cleanAlias);

    console.log(`[ContactManager] Pairing completed with ${fromPeerId} (${cleanAlias})`);
  } catch (e) {
    console.warn('[ContactManager] X3DH response handling failed:', e);
  }
}

/**
 * Reject a connect request.
 * @param {string} requestId
 */
export async function rejectRequest(requestId) {
  pendingIncoming = pendingIncoming.filter(r => r.requestId !== requestId);
  await removePendingRequest(requestId);
}

// ─────────────────── Contact Queries ───────────────────

/**
 * Check if we're paired with a peer by endpointId, UUID, or alias.
 * @param {string} peerId
 * @param {string} [alias]
 * @returns {boolean}
 */
export function isPaired(peerId, alias = null) {
  if (!peerId && !alias) return false;
  if (peerId && pairedContacts.has(peerId)) return true;
  const cleanAlias = alias ? alias.replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase() : null;
  const cleanId = peerId ? peerId.replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase() : null;
  for (const [, contact] of pairedContacts) {
    if (peerId && (contact.uuid === peerId || contact.peerId === peerId || contact.id === peerId)) {
      return true;
    }
    const cAlias = (contact.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
    if (cleanAlias && cAlias && cleanAlias === cAlias) return true;
    if (cleanId && cAlias && cleanId === cAlias) return true;
  }
  return false;
}

/**
 * Get paired contact by endpointId, UUID, or ID.
 * @param {string} id
 * @returns {object|null}
 */
export function getContact(id) {
  if (!id) return null;
  if (pairedContacts.has(id)) return pairedContacts.get(id);
  for (const [, contact] of pairedContacts) {
    if (contact.uuid === id || contact.peerId === id || contact.id === id) {
      return contact;
    }
  }
  return null;
}

/**
 * Get all paired contacts.
 * @returns {{ id: string, peerId: string, alias: string, emoji: string, pairedAt: number, uuid?: string }[]}
 */
export function getPairedContacts() {
  const seen = new Set();
  const list = [];
  for (const [peerId, data] of pairedContacts.entries()) {
    const cleanAlias = (data.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
    const dedupeKey = data.uuid || cleanAlias || peerId;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    list.push({
      id: data.uuid || peerId,
      peerId,
      ...data,
    });
  }
  return list;
}

/**
 * Get pending incoming connect requests.
 * @returns {object[]}
 */
export function getPendingRequests() {
  return [...pendingIncoming];
}

/**
 * Dynamically link a newly connected endpoint to an existing paired contact.
 * Ensures reconnecting peers stay seamlessly connected and authorized.
 */
export async function updateContactEndpoint(uuid, newEndpointId, alias = null) {
  if (!uuid && !alias) return;
  const cleanAlias = (alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
  let found = null;
  let oldKey = null;

  for (const [key, c] of pairedContacts.entries()) {
    const cClean = (c.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
    if ((uuid && c.uuid === uuid) || (cleanAlias && cClean === cleanAlias)) {
      found = c;
      oldKey = key;
      break;
    }
  }

  if (found) {
    if (oldKey !== newEndpointId) {
      pairedContacts.delete(oldKey);
      found.peerId = newEndpointId;
      if (uuid && !found.uuid) found.uuid = uuid;
      pairedContacts.set(newEndpointId, found);
      await _savePairedContacts();
      if (uuid) {
        await linkSessionUUID(newEndpointId, uuid);
      }
      console.log(`[ContactManager] Linked active endpoint ${newEndpointId} to contact ${found.alias} (${uuid})`);
    }
  }
}

/**
 * Revoke pairing with a peer — deletes session keys and purges from trust circle.
 * Cleanses all representations (transient endpointId, persistent device UUID, and alias).
 * @param {string} identifier — endpointId, uuid, or alias
 */
export async function revokePairing(identifier) {
  if (!identifier) return;
  const cleanTarget = identifier.replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();

  const toDelete = [];
  for (const [key, c] of pairedContacts.entries()) {
    const cClean = (c.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
    if (key === identifier || c.uuid === identifier || (cleanTarget && cClean === cleanTarget)) {
      toDelete.push({ key, contact: c });
    }
  }

  for (const item of toDelete) {
    pairedContacts.delete(item.key);
    await revokeSession(item.key);
    if (item.contact.uuid) {
      await revokeSession(item.contact.uuid);
      await removeTrustedPeer(item.contact.uuid);
    }
    if (item.contact.alias) {
      await removeTrustedPeer(item.contact.alias);
      const cleanA = item.contact.alias.replace(/^[\p{Emoji}\s]+/u, '').trim();
      if (cleanA) await removeTrustedPeer(cleanA);
    }
    await removeTrustedPeer(item.key);
  }

  pairedContacts.delete(identifier);
  await revokeSession(identifier);
  await removeTrustedPeer(identifier);

  await _savePairedContacts();
  console.log(`[ContactManager] Pairing completely revoked and cleansed for ${identifier}`);
}

/**
 * Block a peer — revokes pairing and prevents future connect requests.
 * @param {string} peerId
 */
export async function blockPeer(peerId) {
  await revokePairing(peerId);
  blockedPeers.add(peerId);
  await AsyncStorage.setItem(STORE_BLOCKED, JSON.stringify([...blockedPeers]));
}

/**
 * Unblock a peer.
 * @param {string} peerId
 */
export async function unblockPeer(peerId) {
  blockedPeers.delete(peerId);
  await AsyncStorage.setItem(STORE_BLOCKED, JSON.stringify([...blockedPeers]));
}

/**
 * Check if a peer is blocked.
 * @param {string} peerIdOrAlias
 * @returns {boolean}
 */
export function isBlocked(peerIdOrAlias) {
  if (!peerIdOrAlias) return false;
  if (blockedPeers.has(peerIdOrAlias)) return true;
  const clean = peerIdOrAlias.replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
  for (const b of blockedPeers) {
    const cleanB = b.replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
    if (clean && cleanB && clean === cleanB) return true;
  }
  return false;
}

/**
 * Get all blocked peers list.
 * @returns {string[]}
 */
export function getBlockedPeers() {
  return [...blockedPeers];
}

// ─────────────────── Trusted Peers (Auto-Reconnect) ───────────────────

/**
 * Add a peer to the trusted list (auto-accept on reconnect).
 * @param {string} nameOrId
 */
export async function addTrustedPeer(nameOrId) {
  trustedPeers.add(nameOrId);
  await AsyncStorage.setItem(STORE_TRUSTED, JSON.stringify([...trustedPeers]));
}

/**
 * Remove a peer from the trusted list.
 * @param {string} nameOrId
 */
export async function removeTrustedPeer(nameOrId) {
  trustedPeers.delete(nameOrId);
  await AsyncStorage.setItem(STORE_TRUSTED, JSON.stringify([...trustedPeers]));
}

/**
 * Clear all paired contacts, cryptographic sessions, and trusted peers (full trust reset).
 */
export async function clearAllPairedContacts() {
  for (const [peerId] of pairedContacts) {
    try {
      await revokeSession(peerId);
    } catch (e) {
      console.warn(`[ContactManager] Error revoking session for ${peerId}:`, e);
    }
  }
  pairedContacts.clear();
  await AsyncStorage.removeItem(STORE_CONTACTS);

  trustedPeers.clear();
  await AsyncStorage.removeItem(STORE_TRUSTED);

  pendingIncoming = [];
  console.log('[ContactManager] Full reset: cleared all paired contacts, sessions, and trusted peers');
}

/**
 * Clear all trusted peers and paired contacts.
 */
export async function clearAllTrustedPeers() {
  await clearAllPairedContacts();
}

/**
 * Check if a peer is trusted.
 * @param {string} nameOrId
 * @returns {boolean}
 */
export function isPeerTrusted(nameOrId) {
  return trustedPeers.has(nameOrId);
}

/**
 * Get the trusted peers set.
 * @returns {Set<string>}
 */
export function getTrustedPeers() {
  return new Set(trustedPeers);
}

// ─────────────────── Helpers ───────────────────

async function _addPairedContact(peerId, data) {
  // Prune any existing contact with the same UUID or matching normalized alias
  const cleanNewAlias = (data.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
  for (const [existingId, contact] of pairedContacts.entries()) {
    if (existingId === peerId) continue;
    const cleanOldAlias = (contact.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
    const isSameUUID = Boolean(data.uuid && contact.uuid && data.uuid === contact.uuid);
    const isSameAlias = Boolean(cleanNewAlias && cleanOldAlias && cleanNewAlias === cleanOldAlias);
    if (isSameUUID || isSameAlias) {
      console.log(`[ContactManager] Pruning stale contact entry ${existingId} for reconnecting ${data.alias}`);
      pairedContacts.delete(existingId);
    }
  }

  pairedContacts.set(peerId, data);
  await _savePairedContacts();
}

async function _savePairedContacts() {
  await AsyncStorage.setItem(STORE_CONTACTS, JSON.stringify([...pairedContacts.entries()]));
}
