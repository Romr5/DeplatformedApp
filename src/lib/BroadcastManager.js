/**
 * BroadcastManager — Signed Admin Broadcast Posts (§11)
 *
 * Implements flood-propagated, signed-but-unencrypted announcements
 * from verified admin identities.
 *
 * Architecture Doc Reference: Section 11
 */
import {
  signContent, verifySignature, getIsAdmin, getMySigningKey,
  promoteAdmin, registerAdminKey, isAdminKey, getKnownAdminKeys,
} from './AdminKeyRegistry';
import { addAdminBroadcast, getAdminBroadcasts, queuePush } from './crdt';
import { sendMessage } from './p2p';

// Track seen message IDs to prevent relay loops
const seenBroadcasts = new Set();
const seenPromotions = new Set();

/**
 * Publish an admin broadcast post.
 *
 * @param {string} text
 * @param {string} authorAlias
 * @param {string} myId
 * @param {Map<string, object>} connectedPeers
 * @returns {Promise<object>} The published post
 */
export async function publishBroadcast(text, authorAlias, myId, connectedPeers = new Map(), category = 'INFO') {
  if (!getIsAdmin()) {
    throw new Error('Only admins can publish broadcast announcements');
  }

  const postId = 'admin-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const ts = Date.now();
  const signingKey = getMySigningKey();

  const payloadToSign = `${postId}:${ts}:${text}`;
  const signature = await signContent(payloadToSign);

  const post = {
    id: postId,
    from: myId,
    alias: authorAlias,
    text,
    category: category || 'INFO',
    ts,
    signingKey,
    signature,
    verified: true,
  };

  seenBroadcasts.add(postId);
  await addAdminBroadcast(post);

  // Store-and-forward queue so future connected peers automatically receive it
  try {
    await queuePush({ kind: 'admin_broadcast', post });
  } catch {}

  // Flood to all connected peers
  await floodBroadcast(post, connectedPeers);

  console.log(`[BroadcastManager] Published admin post ${postId} with category ${post.category}`);
  return post;
}

/**
 * Handle an incoming broadcast message from a peer.
 * Verifies the ECDSA signature, stores if valid and not seen,
 * and re-floods to all other connected peers.
 *
 * @param {string} fromPeerId
 * @param {object} msg
 * @param {Map<string, object>} connectedPeers
 * @returns {Promise<boolean>}
 */
export async function handleIncomingBroadcast(fromPeerId, msg, connectedPeers = new Map()) {
  const { post } = msg;
  if (!post || !post.id || !post.signature || !post.signingKey || !post.text) {
    console.warn('[BroadcastManager] Received malformed admin post');
    return false;
  }

  // Deduplication check
  if (seenBroadcasts.has(post.id)) {
    return false;
  }
  seenBroadcasts.add(post.id);

  // Verify signature
  const payloadToSign = `${post.id}:${post.ts}:${post.text}`;
  const isValid = await verifySignature(payloadToSign, post.signature, post.signingKey, post.alias || 'Admin');

  if (!isValid) {
    console.warn('[BroadcastManager] Received INVALID signature on admin post:', post.id);
    return false;
  }

  const verifiedPost = { ...post, category: post.category || 'INFO', verified: true };
  const newlyAdded = await addAdminBroadcast(verifiedPost);

  console.log(`[BroadcastManager] Verified and saved admin post ${post.id}`);

  // Re-flood to other connected peers (excluding the sender)
  if (newlyAdded) {
    await floodBroadcast(verifiedPost, connectedPeers, fromPeerId);
  }

  return true;
}

/**
 * Flood a broadcast post to connected peers.
 *
 * @param {object} post
 * @param {Map<string, object>|object} connectedPeers
 * @param {string|null} excludePeerId
 */
export async function floodBroadcast(post, connectedPeers = new Map(), excludePeerId = null) {
  const payload = {
    type: 'ADMIN_BROADCAST',
    post,
  };

  let peersMap = new Map();
  if (connectedPeers instanceof Map) {
    peersMap = connectedPeers;
  } else if (connectedPeers && typeof connectedPeers === 'object') {
    peersMap = new Map(Object.entries(connectedPeers));
  }

  for (const [peerId] of peersMap.entries()) {
    if (peerId === excludePeerId) continue;
    try {
      await sendMessage(peerId, payload);
    } catch (e) {
      console.warn(`[BroadcastManager] Failed to flood to ${peerId}:`, e);
    }
  }
}

/**
 * Promote a contact to admin and broadcast the signed promotion to the mesh.
 *
 * @param {string} peerIdentityPub
 * @param {string} peerAlias
 * @param {string} peerSigningKeyB64
 * @param {string} myIdentityPub
 * @param {Map<string, object>} connectedPeers
 */
export async function promoteContact(peerIdentityPub, peerAlias, peerSigningKeyB64, myIdentityPub, connectedPeers = new Map()) {
  if (!getIsAdmin()) throw new Error('Only admins can promote');

  await promoteAdmin(peerIdentityPub, peerAlias, peerSigningKeyB64, myIdentityPub);

  const promoPayload = `${peerIdentityPub}:${peerSigningKeyB64}:${myIdentityPub}`;
  const signature = await signContent(promoPayload);

  const promoMsg = {
    type: 'ADMIN_PROMOTION',
    peerIdentityPub,
    peerAlias,
    peerSigningKeyB64,
    promotedBy: myIdentityPub,
    signingKey: getMySigningKey(),
    signature,
    ts: Date.now(),
  };

  seenPromotions.add(`${peerIdentityPub}:${peerSigningKeyB64}`);

  // Flood promotion to all connected peers
  for (const [peerId] of connectedPeers) {
    try {
      await sendMessage(peerId, promoMsg);
    } catch (e) {
      console.warn(`[BroadcastManager] Failed to send promotion to ${peerId}:`, e);
    }
  }

  console.log(`[BroadcastManager] Broadcast promotion for ${peerAlias}`);
}

/**
 * Handle incoming admin promotion announcement.
 *
 * @param {string} fromPeerId
 * @param {object} msg
 * @param {Map<string, object>} connectedPeers
 */
export async function handleIncomingPromotion(fromPeerId, msg, connectedPeers = new Map()) {
  const { peerIdentityPub, peerAlias, peerSigningKeyB64, promotedBy, signingKey, signature } = msg;
  const promoKey = `${peerIdentityPub}:${peerSigningKeyB64}`;

  if (seenPromotions.has(promoKey)) return;
  seenPromotions.add(promoKey);

  // Verify signature from the promoter
  const promoPayload = `${peerIdentityPub}:${peerSigningKeyB64}:${promotedBy}`;
  const isValid = await verifySignature(promoPayload, signature, signingKey);

  if (!isValid) {
    console.warn('[BroadcastManager] Invalid signature on admin promotion');
    return;
  }

  await registerAdminKey(peerIdentityPub, {
    alias: peerAlias,
    signingKey: peerSigningKeyB64,
    promotedBy,
    promotedAt: msg.ts || Date.now(),
  });

  console.log(`[BroadcastManager] Registered new admin ${peerAlias} via mesh promotion`);

  // Re-flood promotion to other peers
  for (const [peerId] of connectedPeers) {
    if (peerId === fromPeerId) continue;
    try {
      await sendMessage(peerId, msg);
    } catch {}
  }
}

/**
 * Get all admin broadcasts.
 * @returns {Promise<object[]>}
 */
export async function listBroadcasts() {
  return await getAdminBroadcasts();
}
