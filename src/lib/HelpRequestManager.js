/**
 * HelpRequestManager — 2-Tier Help Requests & Emergency Signaling (§14)
 *
 * Implements:
 * - Tier 1 (Circle): E2E encrypted to paired contacts with exact location
 * - Tier 2 (Broadcast): Anonymized identity + rounded ~100m grid coords, flood-relayed
 * - 24-hour auto-expiry and resolution signalling
 *
 * Architecture Doc Reference: Section 14
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCurrentLocation } from './LocationManager';
import { getPairedContacts } from './ContactManager';
import { encrypt, decrypt } from './crypto';
import { addHelpRequest, getActiveHelpRequests, resolveHelpRequest } from './crdt';
import { sendMessage } from './p2p';

const TTL_24H = 24 * 60 * 60 * 1000;
const STORE_MY_HELP = '@dp_my_active_help_request';

const seenHelpRequests = new Set();
const seenResolutions = new Set();

/**
 * Round coordinates to ~100m grid for privacy.
 * 3 decimal places = ~110m precision at the equator.
 */
export function roundToApproxGrid(lat, lng) {
  if (lat == null || lng == null) return null;
  return {
    lat: Math.round(lat * 1000) / 1000,
    lng: Math.round(lng * 1000) / 1000,
    approx: true,
  };
}

/**
 * Trigger an emergency help request.
 *
 * @param {object} params
 * @param {string[]} params.tiers — ['circle', 'broadcast'] or subset
 * @param {string} params.urgencyType — 'medical' | 'security' | 'supplies' | 'general'
 * @param {string} params.note — optional text message
 * @param {string} params.myId
 * @param {string} params.myAlias
 * @param {Map<string, object>} connectedPeers
 * @returns {Promise<object>}
 */
export async function triggerHelpRequest(params) {
  const {
    tiers = ['circle', 'broadcast'],
    urgencyType = 'general',
    note = '',
    myId,
    myAlias,
    connectedPeers,
    peers,
  } = params;

  // Resolve peers map safely from connectedPeers or peers
  let peersMap = new Map();
  if (connectedPeers instanceof Map) {
    peersMap = connectedPeers;
  } else if (peers instanceof Map) {
    peersMap = peers;
  } else if (connectedPeers && typeof connectedPeers === 'object') {
    peersMap = new Map(Object.entries(connectedPeers));
  } else if (peers && typeof peers === 'object') {
    peersMap = new Map(Object.entries(peers));
  }

  const reqId = 'help-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const now = Date.now();
  const expiresAt = now + TTL_24H;

  // Capture single-fix location
  let loc = null;
  try {
    loc = await getCurrentLocation();
  } catch (err) {
    console.warn('[HelpManager] Location capture failed:', err);
  }

  const baseRequest = {
    id: reqId,
    from: myId,
    alias: myAlias || 'Mesh Peer',
    urgencyType,
    note,
    ts: now,
    expiresAt,
    resolved: false,
    tiers,
  };

  seenHelpRequests.add(reqId);

  // Save to local CRDT
  await addHelpRequest({
    ...baseRequest,
    location: loc,
    isSelf: true,
  });

  // Persist active own request
  await AsyncStorage.setItem(STORE_MY_HELP, reqId);

  // 1. Tier 1: Circle (E2E encrypted to paired contacts)
  if (tiers.includes('circle')) {
    const paired = getPairedContacts ? getPairedContacts() : [];
    for (const contact of paired) {
      // Find active connected endpoint for this paired contact
      let activeEndpoint = null;
      if (contact.peerId && peersMap.has(contact.peerId)) {
        activeEndpoint = contact.peerId;
      } else if (contact.endpointId && peersMap.has(contact.endpointId)) {
        activeEndpoint = contact.endpointId;
      } else {
        const cleanContactAlias = (contact.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
        for (const [epId, p] of peersMap.entries()) {
          const cleanPAlias = (p.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
          if ((contact.uuid && p.uuid === contact.uuid) || (cleanContactAlias && cleanPAlias && cleanContactAlias === cleanPAlias)) {
            activeEndpoint = epId;
            break;
          }
        }
      }

      if (activeEndpoint) {
        const tier1Payload = JSON.stringify({
          ...baseRequest,
          tier: 'circle',
          location: loc, // exact location
        });

        try {
          const enc = await encrypt(activeEndpoint, tier1Payload);
          if (enc) {
            await sendMessage(activeEndpoint, {
              type: 'HELP_REQUEST',
              reqId,
              tier: 'circle',
              header: enc.header,
              iv: enc.iv,
              ct: enc.ct,
              ts: now,
            });
          }
        } catch (e) {
          console.warn(`[HelpManager] Failed to send Tier 1 to ${activeEndpoint}:`, e);
        }
      }
    }
  }

  // 2. Tier 2: Mesh Broadcast (Flood to all connected peers)
  if (tiers.includes('broadcast')) {
    const approxLoc = loc ? roundToApproxGrid(loc.lat, loc.lng) : null;
    const broadcastPayload = {
      type: 'HELP_REQUEST',
      reqId,
      tier: 'broadcast',
      request: {
        id: reqId,
        from: myId,
        alias: myAlias || 'Mesh Peer',
        urgencyType,
        note,
        location: approxLoc,
        ts: now,
        expiresAt,
        resolved: false,
      },
    };

    for (const [peerId] of peersMap.entries()) {
      try {
        await sendMessage(peerId, broadcastPayload);
      } catch (e) {
        console.warn(`[HelpManager] Failed to flood Tier 2 to ${peerId}:`, e);
      }
    }
  }

  console.log(`[HelpManager] Triggered help request ${reqId} (${urgencyType}) to ${peersMap.size} peers`);
  return baseRequest;
}

/**
 * Cancel/resolve an active help request.
 *
 * @param {string} reqId
 * @param {Map<string, object>} connectedPeers
 */
export async function cancelHelpRequest(reqId, connectedPeers = new Map()) {
  await resolveHelpRequest(reqId);
  await AsyncStorage.removeItem(STORE_MY_HELP);

  seenResolutions.add(reqId);

  const resolveMsg = {
    type: 'HELP_RESOLVED',
    reqId,
    resolvedAt: Date.now(),
  };

  const peersMap = connectedPeers instanceof Map ? connectedPeers : new Map();
  for (const [peerId] of peersMap.entries()) {
    try {
      await sendMessage(peerId, resolveMsg);
    } catch {}
  }

  console.log(`[HelpManager] Cancelled/resolved help request ${reqId}`);
}

/**
 * Handle incoming help request from a peer.
 *
 * @param {string} fromPeerId
 * @param {object} msg
 * @param {Map<string, object>} connectedPeers
 */
export async function handleIncomingHelpRequest(fromPeerId, msg, connectedPeers = new Map()) {
  const { reqId, tier } = msg;
  if (!reqId) return null;

  const dedupeKey = `${reqId}:${tier}`;
  if (seenHelpRequests.has(dedupeKey)) return null;

  let reqData = null;

  if (tier === 'circle' && msg.header && msg.ct) {
    // Decrypt Tier 1
    const plain = await decrypt(fromPeerId, msg.header, msg.iv, msg.ct);
    if (plain) {
      try {
        reqData = JSON.parse(plain);
        reqData.tier = 'circle';
        seenHelpRequests.add(dedupeKey);
      } catch {}
    }
  } else if (tier === 'broadcast' && msg.request) {
    reqData = msg.request;
    reqData.tier = 'broadcast';
    seenHelpRequests.add(dedupeKey);

    // Auto-expiry check
    if (reqData.expiresAt && reqData.expiresAt < Date.now()) {
      return null; // expired
    }

    // Re-flood Tier 2 to other connected peers
    for (const [peerId] of connectedPeers) {
      if (peerId === fromPeerId) continue;
      try {
        await sendMessage(peerId, msg);
      } catch {}
    }
  }

  if (reqData) {
    await addHelpRequest(reqData);
    console.log(`[HelpManager] Saved incoming help request ${reqId} (${reqData.urgencyType})`);
    return reqData;
  }
  return null;
}

/**
 * Handle incoming help resolution message.
 *
 * @param {string} fromPeerId
 * @param {object} msg
 * @param {Map<string, object>} connectedPeers
 */
export async function handleIncomingHelpResolution(fromPeerId, msg, connectedPeers = new Map()) {
  const { reqId } = msg;
  if (!reqId || seenResolutions.has(reqId)) return;
  seenResolutions.add(reqId);

  await resolveHelpRequest(reqId);

  // Re-flood resolution
  for (const [peerId] of connectedPeers) {
    if (peerId === fromPeerId) continue;
    try {
      await sendMessage(peerId, msg);
    } catch {}
  }
}

/**
 * Check if the current device has an active help request.
 * @returns {Promise<string|null>}
 */
export async function getMyActiveHelpRequestId() {
  try {
    return await AsyncStorage.getItem(STORE_MY_HELP);
  } catch {
    return null;
  }
}

/**
 * List active help requests from all peers.
 * @returns {Promise<object[]>}
 */
export async function listActiveRequests() {
  return await getActiveHelpRequests();
}
