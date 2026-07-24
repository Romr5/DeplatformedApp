/**
 * P2P Layer — Thin Facade over Transport Abstraction
 *
 * This module preserves the existing public API consumed by AppContext.jsx
 * and screens, but delegates all work to the new NearbyTransport + RelayEngine.
 *
 * Existing callers continue to work without changes:
 *   import { initP2P, sendMessage, startDiscovery, ... } from './lib/p2p';
 *
 * Architecture Doc Reference: Section 4 (Transport Abstraction)
 */
import { NearbyTransport, RelayEngine } from './transport';

// Singleton instances
let nearbyTransport = null;
let relayEngine = null;
let messageSubscribers = [];

/**
 * Request Android permissions for P2P transport.
 */
export async function requestPermissions() {
  nearbyTransport = new NearbyTransport();
  return await nearbyTransport.requestPermissions();
}

/**
 * Initialize the P2P layer with lifecycle and message callbacks.
 *
 * @param {object} callbacks
 * @param {function} callbacks.onPeerDiscovered    — (peer) => void
 * @param {function} callbacks.onPeerConnected     — (peerId, peerName) => void
 * @param {function} callbacks.onPeerDisconnected  — (peerId) => void
 * @param {function} callbacks.onConnectionRequest — (info) => void
 * @param {function} callbacks.onMessageReceived   — (fromId, msg) => void (optional, legacy)
 */
export async function initP2P(callbacks) {
  // Create transport + engine if not already done
  if (!nearbyTransport) {
    nearbyTransport = new NearbyTransport();
  }

  relayEngine = new RelayEngine();
  relayEngine.registerTransport(nearbyTransport);

  // Wire lifecycle callbacks
  relayEngine.onLifecycle({
    onPeerDiscovered:    callbacks.onPeerDiscovered,
    onPeerLost:          callbacks.onPeerLost,
    onPeerConnected:     callbacks.onPeerConnected,
    onPeerDisconnected:  callbacks.onPeerDisconnected,
    onConnectionRequest: callbacks.onConnectionRequest,
  });

  // Wire message receive — dispatch to subscribers
  relayEngine.onMessage((fromId, msg) => {
    messageSubscribers.forEach(cb => {
      try { cb(fromId, msg); } catch (e) { console.warn(e); }
    });
  });

  console.log('[P2P] Transport layer initialized via RelayEngine');
}

/**
 * Subscribe to incoming P2P messages.
 * @param {function} callback — (fromEndpointId, message) => void
 * @returns {function} unsubscribe
 */
export function subscribeMessages(callback) {
  messageSubscribers.push(callback);
  return () => {
    messageSubscribers = messageSubscribers.filter(cb => cb !== callback);
  };
}

/**
 * Start advertising + discovery.
 * @param {string} myName
 */
export async function startDiscovery(myName = 'Peer') {
  if (!relayEngine) return;
  await relayEngine.startAll(myName);
}

/**
 * Restart discovery and advertising across transports.
 * @param {string} myName
 */
export async function restartDiscovery(myName = 'Peer') {
  if (!relayEngine) return;
  await relayEngine.restartDiscovery(myName);
}

/**
 * Resync any already active native connections.
 */
export async function resyncConnections() {
  if (nearbyTransport && nearbyTransport.resyncConnections) {
    return await nearbyTransport.resyncConnections();
  }
  return 0;
}

/**
 * Stop all endpoints and discovery.
 */
export async function stopDiscovery() {
  if (!relayEngine) return;
  await relayEngine.stopAll();
}

/**
 * Request connection to a discovered peer.
 * @param {string} endpointId
 * @param {string} myName
 */
export async function connectToPeer(endpointId, myName = 'Peer') {
  if (!relayEngine) return;
  await relayEngine.connectToPeer(endpointId, myName);
}

/**
 * Accept an incoming connection request.
 * @param {string} endpointId
 */
export async function acceptConnection(endpointId) {
  if (!relayEngine) return;
  await relayEngine.acceptConnection(endpointId);
}

/**
 * Reject an incoming connection request.
 * @param {string} endpointId
 */
export async function rejectConnection(endpointId) {
  if (!relayEngine) return;
  await relayEngine.rejectConnection(endpointId);
}

/**
 * Disconnect from a specific peer.
 * @param {string} endpointId
 */
export async function disconnectPeer(endpointId) {
  if (!relayEngine) return;
  await relayEngine.disconnectPeer(endpointId);
}

/**
 * Send a message to a specific peer.
 * @param {string} endpointId
 * @param {object|string} message
 * @returns {Promise<boolean>}
 */
export async function sendMessage(endpointId, message) {
  if (!relayEngine) return false;
  return await relayEngine.send(endpointId, message);
}

/**
 * Relay an opaque packet across the mesh to a multi-hop destination.
 * @param {string} targetPeerId
 * @param {object} payload
 * @param {string} originId
 * @returns {Promise<boolean>}
 */
export async function relayMessage(targetPeerId, payload, originId) {
  if (!relayEngine) return false;
  return await relayEngine.relayToMesh(targetPeerId, payload, originId);
}

/**
 * Set the local device identity attributes on RelayEngine.
 */
export function setMyIdentity(identity) {
  if (relayEngine) {
    relayEngine.setMyIdentity(identity);
  }
}

/**
 * Broadcast a message to all connected peers.
 * @param {object|string} message
 * @param {string|null} excludePeerId
 */
export async function broadcastMessage(message, excludePeerId = null) {
  if (!relayEngine) return;
  await relayEngine.broadcast(message, excludePeerId);
}

/**
 * Get the RelayEngine instance for advanced operations (relay envelopes, etc.)
 * @returns {RelayEngine|null}
 */
export function getRelayEngine() {
  return relayEngine;
}

/**
 * Flush queued relay envelopes when a peer connects and resolves their identity.
 */
export async function flushRelayQueueForPeer(peerId, peerUUID = null, peerAlias = null) {
  if (relayEngine) {
    await relayEngine.flushRelayQueueForPeer(peerId, peerUUID, peerAlias);
  }
}

/**
 * Get available peers (placeholder for future transport-level peer list).
 */
export async function getAvailablePeers() {
  return [];
}

/**
 * Cleanup — stop all transports.
 */
export function cleanup() {
  if (relayEngine) {
    relayEngine.stopAll().catch(() => {});
  }
}
