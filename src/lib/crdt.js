/**
 * CRDT — Grow-Only Set backed by AsyncStorage
 * Ported from the web app's localStorage version.
 * Deduplicates by UUID, sorts by timestamp, persists across restarts.
 *
 * v2: Added room message stores and admin broadcast store.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { decryptGroupMessage } from './crypto/groupCrypto';

const STORE_CHAT   = 'dp_chat';
const STORE_BULL   = 'dp_bulletin';
const STORE_QUEUE  = 'dp_queue';
const STORE_ADMIN  = 'dp_admin_broadcasts';
const STORE_HELP   = 'dp_help_requests';

// Room messages use dynamic keys: dp_room_msgs_{roomId}

async function load(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return new Map(JSON.parse(raw || '[]'));
  } catch {
    return new Map();
  }
}

async function save(key, map) {
  await AsyncStorage.setItem(key, JSON.stringify([...map.entries()]));
}

// ─────────────────── Chat ───────────────────

export async function addChat(m) {
  const chat = await load(STORE_CHAT);
  if (chat.has(m.id)) return false;
  chat.set(m.id, m);
  await save(STORE_CHAT, chat);
  return true;
}

export async function getChat() {
  const chat = await load(STORE_CHAT);
  return [...chat.values()].sort((a, b) => a.ts - b.ts);
}

/**
 * Get public mesh broadcast messages only (targetId is null or undefined).
 * @returns {Promise<object[]>}
 */
export async function getBroadcastMessages() {
  const chat = await load(STORE_CHAT);
  return [...chat.values()]
    .filter(m => !m.targetId)
    .sort((a, b) => a.ts - b.ts);
}

/**
 * Get direct 1-on-1 private messages between local user and a specific peer.
 * Matches by endpoint ID, persistent device UUID, or alias.
 * @param {string} peerId
 * @param {string} myId
 * @param {string} [peerUUID]
 * @param {string} [targetAlias]
 * @returns {Promise<object[]>}
 */
export async function getDirectMessages(peerId, myId, peerUUID = null, targetAlias = null) {
  if (!peerId && !peerUUID && !targetAlias) return [];
  const chat = await load(STORE_CHAT);
  const cleanTargetAlias = (targetAlias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();

  return [...chat.values()]
    .filter(m => {
      const isPeer = (id) => Boolean(id && (id === peerId || (peerUUID && id === peerUUID)));
      const isMe = (id) => Boolean(id && id === myId);
      const mAlias = (m.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
      const mTargetAlias = (m.targetAlias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
      const aliasMatches = Boolean(
        cleanTargetAlias && (
          (mAlias && mAlias === cleanTargetAlias) ||
          (mTargetAlias && mTargetAlias === cleanTargetAlias)
        )
      );

      // Incoming: message was sent by the peer
      if (isPeer(m.from) || (!isMe(m.from) && aliasMatches)) {
        // Exclude if explicitly targeted to someone else (not me and not this device's endpoint)
        if (m.targetId && isPeer(m.targetId)) {
          return false; // loopback/sent to self by peer
        }
        return true;
      }

      // Outgoing: message was sent by me to this peer
      if (isMe(m.from)) {
        if (isPeer(m.targetId) || isPeer(m.targetEndpointId)) {
          return true;
        }
        if (aliasMatches) {
          return true;
        }
      }

      return false;
    })
    .sort((a, b) => a.ts - b.ts);
}

/**
 * Get the latest direct message with a peer.
 * @param {string} peerId
 * @param {string} myId
 * @param {string} [peerUUID]
 * @param {string} [targetAlias]
 * @returns {Promise<object|null>}
 */
export async function getLastDirectMessage(peerId, myId, peerUUID = null, targetAlias = null) {
  const msgs = await getDirectMessages(peerId, myId, peerUUID, targetAlias);
  return msgs.length > 0 ? msgs[msgs.length - 1] : null;
}

/**
 * Get the latest broadcast message.
 * @returns {Promise<object|null>}
 */
export async function getLastBroadcastMessage() {
  const msgs = await getBroadcastMessages();
  return msgs.length > 0 ? msgs[msgs.length - 1] : null;
}


/**
 * Clear all 1:1 direct messages exchanged with a specific peer.
 */
export async function clearDirectMessages(peerId, myId, peerUUID = null) {
  const chat = await load(STORE_CHAT);
  let changed = false;
  const isPeer = (id) => Boolean(id && (id === peerId || (peerUUID && id === peerUUID)));
  const isMe = (id) => Boolean(id && id === myId);

  for (const [id, m] of chat.entries()) {
    if ((isPeer(m.from) && (!m.targetId || isMe(m.targetId))) || (isMe(m.from) && isPeer(m.targetId))) {
      chat.delete(id);
      changed = true;
    }
  }
  if (changed) {
    await save(STORE_CHAT, chat);
  }
}

/**
 * Get all distinct peer conversations from message history.
 * Ensures conversations persist in inbox even when peers go out of radio range.
 * @param {string} myId - Local device UUID
 * @returns {Promise<Array<{ peerId: string, uuid: string|null, alias: string, lastMsg: object }>>}
 */
export async function getAllDirectConversations(myId) {
  const chat = await load(STORE_CHAT);
  const convMap = new Map();

  for (const m of chat.values()) {
    if (!m) continue;
    let otherId = null;
    let otherAlias = null;

    if (m.from && m.from !== myId) {
      otherId = m.from;
      otherAlias = m.alias;
    } else if (m.targetId && m.targetId !== myId) {
      otherId = m.targetId;
      otherAlias = m.targetAlias || null;
    }

    if (!otherId) continue;

    const cleanAlias = (otherAlias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
    const mapKey = cleanAlias || otherId;

    const existing = convMap.get(mapKey);
    if (!existing || (m.ts && m.ts > (existing.lastMsg?.ts || 0))) {
      convMap.set(mapKey, {
        peerId: otherId,
        uuid: otherId,
        alias: otherAlias || existing?.alias || 'Peer',
        lastMsg: m,
      });
    }
  }

  return [...convMap.values()].sort((a, b) => (b.lastMsg?.ts || 0) - (a.lastMsg?.ts || 0));
}

// ─────────────────── Bulletin ───────────────────

export async function addBulletin(p) {
  const bull = await load(STORE_BULL);
  if (bull.has(p.id)) return false;
  bull.set(p.id, p);
  await save(STORE_BULL, bull);
  return true;
}

export async function getBulletin() {
  const bull = await load(STORE_BULL);
  return [...bull.values()].sort((a, b) => b.ts - a.ts);
}

// ─────────────────── Room Messages (v2) ───────────────────

/**
 * Add a message to a room's chat thread.
 * @param {string} roomId
 * @param {object} msg — { id, from, alias, text, ts, roomId }
 * @returns {Promise<boolean>}
 */
export async function addRoomMessage(roomId, msg) {
  const key = `dp_room_msgs_${roomId}`;
  const room = await load(key);
  if (room.has(msg.id)) return false;
  room.set(msg.id, msg);
  await save(key, room);
  return true;
}

/**
 * Get messages for a room, sorted by timestamp.
 * @param {string} roomId
 * @returns {Promise<object[]>}
 */
export async function getRoomMessages(roomId) {
  const key = `dp_room_msgs_${roomId}`;
  const room = await load(key);
  const msgs = [...room.values()];
  let needsSave = false;
  for (const m of msgs) {
    if ((!m.text || m.text.includes('[decrypt error')) && m.iv && m.ct) {
      try {
        const plain = decryptGroupMessage(roomId, m.iv, m.ct);
        if (plain) {
          m.text = plain;
          room.set(m.id, m);
          needsSave = true;
        }
      } catch {}
    }
  }
  if (needsSave) {
    await save(key, room);
  }
  return msgs.sort((a, b) => a.ts - b.ts);
}

/**
 * Get the latest message for a room.
 * @param {string} roomId
 * @returns {Promise<object|null>}
 */
export async function getLastRoomMessage(roomId) {
  const msgs = await getRoomMessages(roomId);
  return msgs.length > 0 ? msgs[msgs.length - 1] : null;
}

/**
 * Delete all messages for a room (when leaving).
 * @param {string} roomId
 */
export async function clearRoomMessages(roomId) {
  await AsyncStorage.removeItem(`dp_room_msgs_${roomId}`);
}

// ─────────────────── Admin Broadcasts (v2) ───────────────────

/**
 * Add an admin broadcast post.
 * @param {object} post — { id, from, alias, text, signature, ts, verified }
 * @returns {Promise<boolean>}
 */
export async function addAdminBroadcast(post) {
  const store = await load(STORE_ADMIN);
  if (store.has(post.id)) return false;
  store.set(post.id, post);
  await save(STORE_ADMIN, store);
  return true;
}

/**
 * Get all admin broadcasts, newest first.
 * @returns {Promise<object[]>}
 */
export async function getAdminBroadcasts() {
  const store = await load(STORE_ADMIN);
  return [...store.values()].sort((a, b) => b.ts - a.ts);
}

// ─────────────────── Help Requests (v2) ───────────────────

/**
 * Add/update a help request.
 * @param {object} req — { id, from, tier, urgencyType, location, ts, expiresAt, resolved }
 * @returns {Promise<boolean>}
 */
export async function addHelpRequest(req) {
  const store = await load(STORE_HELP);
  store.set(req.id, req);
  await save(STORE_HELP, store);
  return true;
}

/**
 * Get active (non-expired, non-resolved) help requests.
 * @returns {Promise<object[]>}
 */
export async function getActiveHelpRequests() {
  const store = await load(STORE_HELP);
  const now = Date.now();
  return [...store.values()]
    .filter(r => !r.resolved && (!r.expiresAt || r.expiresAt > now))
    .sort((a, b) => b.ts - a.ts);
}

/**
 * Mark a help request as resolved.
 * @param {string} requestId
 */
export async function resolveHelpRequest(requestId) {
  const store = await load(STORE_HELP);
  const req = store.get(requestId);
  if (req) {
    req.resolved = true;
    store.set(requestId, req);
    await save(STORE_HELP, store);
  }
}

// ─────────────────── Export / Merge / Stats ───────────────────

export async function exportAll() {
  const chat = await load(STORE_CHAT);
  const bull = await load(STORE_BULL);
  return {
    chat: [...chat.values()],
    bulletin: [...bull.values()],
  };
}

export async function mergeAll(state) {
  let n = 0;
  for (const m of (state.chat || [])) { if (await addChat(m)) n++; }
  for (const p of (state.bulletin || [])) { if (await addBulletin(p)) n++; }
  return n;
}

export async function getStats() {
  const chat = await load(STORE_CHAT);
  const bull = await load(STORE_BULL);
  return { msgs: chat.size, posts: bull.size };
}

// ─────────────────── Offline Queue ───────────────────

export async function queuePush(item) {
  const q = await queueLoad();
  q.push(item);
  await AsyncStorage.setItem(STORE_QUEUE, JSON.stringify(q));
}

export async function queueDrain() {
  const q = await queueLoad();
  await AsyncStorage.removeItem(STORE_QUEUE);
  return q;
}

export async function queueSize() {
  return (await queueLoad()).length;
}

async function queueLoad() {
  try {
    return JSON.parse(await AsyncStorage.getItem(STORE_QUEUE) || '[]');
  } catch { return []; }
}

export async function purgeAllCrdtStores() {
  try {
    await AsyncStorage.multiRemove([STORE_CHAT, STORE_BULL, STORE_QUEUE, STORE_ADMIN, STORE_HELP]);
  } catch {}
}
