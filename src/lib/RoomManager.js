/**
 * RoomManager — Group Chat / Rooms (§10)
 *
 * Manages multi-member rooms with invite-only membership.
 * Built on top of the pairing model — you can only invite paired contacts.
 *
 * Architecture Doc Reference: Section 10
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isPaired } from './ContactManager';
import {
  generateSenderKey, distributeSenderKey, rotateSenderKey,
  handleSenderKeyDistribution, deleteSenderKey, loadSenderKeys,
  encryptWithSenderKey, decryptGroupMessage,
} from './crypto/groupCrypto';
import { sendMessage, broadcastMessage } from './p2p';
import { addRoomMessage, getRoomMessages } from './crdt';

const STORE_ROOMS = '@dp_rooms';

// In-memory state
let rooms = new Map(); // roomId -> { name, members, createdBy, createdAt, senderKeyVersion }

function genId() {
  return 'room-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Deduplicate members list by peerId, id, and alias.
 * @param {object[]} members
 * @returns {object[]}
 */
export function deduplicateMembers(members) {
  if (!members || !Array.isArray(members)) return [];
  const seenIds = new Set();
  const seenAliases = new Set();
  return members.filter(m => {
    if (!m) return false;
    const idKey = m.peerId || m.id;
    const rawAlias = (m.alias || '').trim().toLowerCase();
    const cleanName = rawAlias.replace(/^[^\w\s]+/, '').trim();

    if (idKey && seenIds.has(idKey)) return false;
    if (cleanName && seenAliases.has(cleanName)) return false;

    if (idKey) seenIds.add(idKey);
    if (cleanName) seenAliases.add(cleanName);
    return true;
  });
}

// ─────────────────── Init ───────────────────

/**
 * Load rooms and sender keys from storage.
 */
export async function initRoomManager() {
  try {
    const raw = await AsyncStorage.getItem(STORE_ROOMS);
    if (raw) {
      const parsed = JSON.parse(raw);
      rooms = new Map();
      for (const [id, r] of parsed) {
        if (r && r.members) {
          r.members = deduplicateMembers(r.members);
        }
        rooms.set(id, r);
      }
    }
  } catch {}
  await loadSenderKeys();
}

// ─────────────────── Room CRUD ───────────────────

/**
 * Create a new room.
 * @param {string} roomName
 * @param {string} myId — creator's UUID
 * @param {string} myAlias
 * @returns {Promise<string>} roomId
 */
export async function createRoom(roomName, myId, myAlias) {
  const roomId = genId();
  const room = {
    id: roomId,
    name: roomName,
    members: [{ peerId: myId, alias: myAlias, isCreator: true }],
    createdBy: myId,
    createdAt: Date.now(),
    senderKeyVersion: 0,
  };

  rooms.set(roomId, room);
  await _saveRooms();

  // Generate sender key
  const keyEntry = await generateSenderKey(roomId);
  room.senderKeyVersion = keyEntry.version;
  await _saveRooms();

  console.log(`[RoomManager] Created room "${roomName}" (${roomId})`);
  return roomId;
}

/**
 * Invite a paired contact to a room.
 * @param {string} roomId
 * @param {string} peerId — target peer endpoint ID
 * @param {string} peerAlias
 * @param {string} myId
 */
export async function inviteMember(roomId, peerId, peerAlias, myId) {
  const room = rooms.get(roomId);
  if (!room) throw new Error('Room not found');

  const cleanTargetAlias = (peerAlias || '').trim().toLowerCase();
  const cleanTargetName = cleanTargetAlias.replace(/^[^\w\s]+/, '').trim();

  // Check if already a member by ID, endpoint, or clean alias
  const alreadyMember = room.members.some(m => {
    const mId = m.peerId || m.id;
    if (mId && peerId && mId === peerId) return true;
    const mAlias = (m.alias || '').trim().toLowerCase();
    const mName = mAlias.replace(/^[^\w\s]+/, '').trim();
    if (cleanTargetName && mName && cleanTargetName === mName) return true;
    return false;
  });

  if (alreadyMember) {
    console.log(`[RoomManager] Peer "${peerAlias}" (${peerId}) is already a member of room "${room.name}"`);
    return false;
  }

  // Add to member list and deduplicate
  room.members.push({ peerId, alias: peerAlias, joinedAt: Date.now() });
  room.members = deduplicateMembers(room.members);
  await _saveRooms();

  // Send room invite
  await sendMessage(peerId, {
    type: 'ROOM_INVITE',
    from: myId,
    roomId,
    roomName: room.name,
    members: room.members.map(m => ({ alias: m.alias, peerId: m.peerId })),
  });

  // Distribute sender key to the new member
  await distributeSenderKey(roomId, peerId, myId);

  console.log(`[RoomManager] Invited ${peerAlias} to room "${room.name}"`);
  return true;
}

/**
 * Handle an incoming room invite.
 * @param {string} fromPeerId
 * @param {object} msg
 * @param {string} myId
 * @param {string} myAlias
 */
export async function handleRoomInvite(fromPeerId, msg, myId, myAlias) {
  const { roomId, roomName, members } = msg;

  if (rooms.has(roomId)) {
    const room = rooms.get(roomId);
    if (members && Array.isArray(members)) {
      for (const m of members) {
        if (!room.members.some(em => em.peerId === m.peerId || em.alias === m.alias)) {
          room.members.push(m);
        }
      }
      room.members = deduplicateMembers(room.members);
      await _saveRooms();
    }
    return;
  }

  const room = {
    id: roomId,
    name: roomName,
    members: deduplicateMembers(members || [{ peerId: fromPeerId, alias: msg.fromAlias || 'Peer' }]),
    createdBy: msg.from,
    createdAt: Date.now(),
    senderKeyVersion: 0,
  };

  // Add self to members if not already there
  if (!room.members.some(m => m.peerId === myId || m.alias === myAlias)) {
    room.members.push({ peerId: myId, alias: myAlias, joinedAt: Date.now() });
  }
  room.members = deduplicateMembers(room.members);

  rooms.set(roomId, room);
  await _saveRooms();

  // Proactively request sender key from the room inviter/creator
  try {
    await sendMessage(fromPeerId, {
      type: 'ROOM_KEY_REQUEST',
      roomId,
      from: myId,
    });
  } catch {}

  console.log(`[RoomManager] Joined room "${roomName}" (${roomId})`);
}

/**
 * Remove a member from a room (and rotate sender key).
 * @param {string} roomId
 * @param {string} peerId — member to remove
 * @param {string} myId
 */
export async function removeMember(roomId, peerId, myId) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.members = room.members.filter(m => m.peerId !== peerId);
  await _saveRooms();

  // Notify the removed member
  await sendMessage(peerId, {
    type: 'ROOM_REMOVED',
    from: myId,
    roomId,
  });

  // Rotate sender key so removed member can't read future messages
  const remainingPeerIds = room.members
    .filter(m => m.peerId !== myId)
    .map(m => m.peerId);

  await rotateSenderKey(roomId, remainingPeerIds, myId);
  room.senderKeyVersion++;
  await _saveRooms();

  console.log(`[RoomManager] Removed member from room "${room.name}"`);
}

/**
 * Handle being removed from a room.
 * @param {object} msg
 */
export async function handleRoomRemoved(msg) {
  const { roomId } = msg;
  rooms.delete(roomId);
  await deleteSenderKey(roomId);
  await _saveRooms();
  console.log(`[RoomManager] Removed from room ${roomId}`);
}

/**
 * Leave a room voluntarily.
 * @param {string} roomId
 * @param {string} myId
 */
export async function leaveRoom(roomId, myId) {
  const room = rooms.get(roomId);
  if (!room) return;

  // Notify other members
  for (const member of room.members) {
    if (member.peerId !== myId) {
      await sendMessage(member.peerId, {
        type: 'ROOM_MEMBER_LEFT',
        from: myId,
        roomId,
      });
    }
  }

  rooms.delete(roomId);
  await deleteSenderKey(roomId);
  await _saveRooms();
}

/**
 * Handle a member leaving.
 * @param {string} fromPeerId
 * @param {object} msg
 */
export async function handleMemberLeft(fromPeerId, msg) {
  const room = rooms.get(msg.roomId);
  if (!room) return;
  room.members = room.members.filter(m => m.peerId !== fromPeerId);
  await _saveRooms();
}

// ─────────────────── Group Messaging ───────────────────

/**
 * Send a message to a room (encrypted with sender key).
 * @param {string} roomId
 * @param {string} text
 * @param {string} myId
 * @param {string} myAlias
 */
export async function sendGroupMessage(roomId, text, myId, myAlias) {
  const room = rooms.get(roomId);
  if (!room) return;

  const msgId = 'gmsg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const ts = Date.now();

  // Encrypt with sender key
  const enc = encryptWithSenderKey(roomId, text);

  const localMsg = { id: msgId, from: myId, alias: myAlias, text, ts, roomId, iv: enc?.iv, ct: enc?.ct };
  await addRoomMessage(roomId, localMsg);

  const payload = enc
    ? {
        type: 'ROOM_MSG', id: msgId, from: myId, fromAlias: myAlias,
        roomId, ts,
        iv: enc.iv, ct: enc.ct, keyVersion: enc.keyVersion,
      }
    : {
        type: 'ROOM_MSG', id: msgId, from: myId, fromAlias: myAlias,
        roomId, ts, text,
      };

  // 1. Send directly to each listed room member
  for (const member of room.members) {
    if (member.peerId === myId) continue;
    try {
      await sendMessage(member.peerId, payload);
    } catch {}
  }

  // 2. Broadcast across local mesh so all connected members receive immediately
  try {
    await broadcastMessage(payload);
  } catch {}
}

/**
 * Handle an incoming room message.
 * @param {string} fromPeerId
 * @param {object} msg
 */
export async function handleRoomMessage(fromPeerId, msg) {
  const { roomId, id, fromAlias, ts } = msg;

  let text;
  if (msg.iv && msg.ct) {
    text = decryptGroupMessage(roomId, msg.iv, msg.ct);
    if (!text) {
      text = '[decrypt error - missing sender key?]';
      // Proactively request the sender key from the peer
      try {
        await sendMessage(fromPeerId, {
          type: 'ROOM_KEY_REQUEST',
          roomId,
          from: msg.from,
        });
      } catch {}
    }
  } else {
    text = msg.text;
  }

  const localMsg = { id, from: fromPeerId, alias: fromAlias, text, ts, roomId, iv: msg.iv, ct: msg.ct };
  await addRoomMessage(roomId, localMsg);
}

// ─────────────────── Queries ───────────────────

/**
 * List all rooms.
 * @returns {{ id: string, name: string, members: object[], createdAt: number }[]}
 */
export function listRooms() {
  return [...rooms.values()].map(r => ({
    ...r,
    members: deduplicateMembers(r.members),
  }));
}

/**
 * Get a room by ID.
 * @param {string} roomId
 * @returns {object|null}
 */
export function getRoom(roomId) {
  const r = rooms.get(roomId);
  if (!r) return null;
  return {
    ...r,
    members: deduplicateMembers(r.members),
  };
}

/**
 * Get room members.
 * @param {string} roomId
 * @returns {object[]}
 */
export function getRoomMembers(roomId) {
  const room = rooms.get(roomId);
  return room ? deduplicateMembers(room.members) : [];
}

// ─────────────────── Persistence ───────────────────

async function _saveRooms() {
  await AsyncStorage.setItem(STORE_ROOMS, JSON.stringify([...rooms.entries()]));
}
