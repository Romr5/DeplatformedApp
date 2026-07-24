/**
 * SessionStore — Persistent storage for crypto sessions and identity.
 *
 * Stores per-peer ratchet state, X3DH identity keys, and session metadata
 * in AsyncStorage. Handles serialization/deserialization of CryptoKey objects.
 *
 * Architecture Doc Reference: Sections 3.2, 7
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { exportIdentity, importIdentity } from './x3dh';
import { exportSession, importSession } from './doubleRatchet';

const STORE_IDENTITY   = '@dp_x3dh_identity';
const STORE_SESSIONS   = '@dp_ratchet_sessions';
const STORE_PENDING    = '@dp_pending_requests';

// ─────────────────────── Identity Persistence ───────────────────────

/**
 * Save the X3DH identity to AsyncStorage.
 * @param {import('./x3dh').X3DHIdentity} identity
 */
export async function saveIdentity(identity) {
  try {
    const data = await exportIdentity(identity);
    await AsyncStorage.setItem(STORE_IDENTITY, JSON.stringify(data));
  } catch (e) {
    console.warn('[SessionStore] Failed to save identity:', e);
  }
}

/**
 * Load the X3DH identity from AsyncStorage.
 * @returns {Promise<import('./x3dh').X3DHIdentity|null>}
 */
export async function loadIdentity() {
  try {
    const raw = await AsyncStorage.getItem(STORE_IDENTITY);
    if (!raw) return null;
    return await importIdentity(JSON.parse(raw));
  } catch (e) {
    console.warn('[SessionStore] Failed to load identity:', e);
    return null;
  }
}

/**
 * Clear the stored identity (used during full reset).
 */
export async function clearIdentity() {
  await AsyncStorage.removeItem(STORE_IDENTITY);
}

// ─────────────────────── Session Persistence ───────────────────────

/**
 * Save a peer's ratchet session.
 * @param {string} peerId
 * @param {import('./doubleRatchet').RatchetSession} session
 */
export async function saveSession(peerId, session) {
  try {
    const sessions = await _loadAllSessions();
    const exported = await exportSession(session);
    sessions[peerId] = exported;
    await AsyncStorage.setItem(STORE_SESSIONS, JSON.stringify(sessions));
  } catch (e) {
    console.warn('[SessionStore] Failed to save session:', e);
  }
}

/**
 * Load a peer's ratchet session.
 * @param {string} peerId
 * @returns {Promise<import('./doubleRatchet').RatchetSession|null>}
 */
export async function loadSession(peerId) {
  try {
    const sessions = await _loadAllSessions();
    if (!sessions[peerId]) return null;
    return await importSession(sessions[peerId]);
  } catch (e) {
    console.warn('[SessionStore] Failed to load session:', e);
    return null;
  }
}

/**
 * Delete a peer's session (used on revoke/unpair).
 * @param {string} peerId
 */
export async function deleteSession(peerId) {
  try {
    const sessions = await _loadAllSessions();
    delete sessions[peerId];
    await AsyncStorage.setItem(STORE_SESSIONS, JSON.stringify(sessions));
  } catch (e) {
    console.warn('[SessionStore] Failed to delete session:', e);
  }
}

/**
 * Check if a session exists for a peer.
 * @param {string} peerId
 * @returns {Promise<boolean>}
 */
export async function hasSession(peerId) {
  const sessions = await _loadAllSessions();
  return !!sessions[peerId];
}

/**
 * Get all peer IDs with active sessions.
 * @returns {Promise<string[]>}
 */
export async function getSessionPeerIds() {
  const sessions = await _loadAllSessions();
  return Object.keys(sessions);
}

/**
 * Clear all sessions (full reset).
 */
export async function clearAllSessions() {
  await AsyncStorage.removeItem(STORE_SESSIONS);
}

// ─────────────────────── Pending Pairing Requests ───────────────────────

/**
 * Save a pending connect request.
 * @param {object} request — { requestId, peerId, peerAlias, peerBundle, direction, ts }
 */
export async function savePendingRequest(request) {
  try {
    const pending = await loadPendingRequests();
    pending.push(request);
    await AsyncStorage.setItem(STORE_PENDING, JSON.stringify(pending));
  } catch (e) {
    console.warn('[SessionStore] Failed to save pending request:', e);
  }
}

/**
 * Load all pending connect requests.
 * @returns {Promise<object[]>}
 */
export async function loadPendingRequests() {
  try {
    const raw = await AsyncStorage.getItem(STORE_PENDING);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Remove a pending request by ID.
 * @param {string} requestId
 */
export async function removePendingRequest(requestId) {
  try {
    const pending = await loadPendingRequests();
    const filtered = pending.filter(r => r.requestId !== requestId);
    await AsyncStorage.setItem(STORE_PENDING, JSON.stringify(filtered));
  } catch (e) {
    console.warn('[SessionStore] Failed to remove pending request:', e);
  }
}

/**
 * Clear all pending requests.
 */
export async function clearPendingRequests() {
  await AsyncStorage.removeItem(STORE_PENDING);
}

// ─────────────────────── Helpers ───────────────────────

async function _loadAllSessions() {
  try {
    const raw = await AsyncStorage.getItem(STORE_SESSIONS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
