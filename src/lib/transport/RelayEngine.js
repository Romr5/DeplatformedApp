/**
 * RelayEngine — Multi-transport manager with store-and-forward relay.
 *
 * Manages multiple TransportProvider instances and provides a unified
 * send/receive interface. Also implements permissionless store-and-forward
 * relay: encrypted envelopes addressed to other peers are re-forwarded
 * without needing pairing or decryption ability.
 *
 * Architecture Doc Reference: Sections 4, 3.3, 5 (Step 6)
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const RELAY_QUEUE_KEY = 'dp_relay_queue';
const MAX_TTL = 10;             // Max hops before a relayed envelope is dropped
const MAX_RELAY_QUEUE = 200;    // Max queued relay envelopes
const RELAY_ENVELOPE_MAX_BYTES = 65536; // 64KB max envelope size

export class RelayEngine {
  constructor() {
    /** @type {import('./TransportProvider').TransportProvider[]} */
    this._transports = [];
    this._messageCallbacks = [];
    this._lifecycleCallbacks = [];
    this._connectedPeers = new Map(); // peerId -> { transport, name }
    this._myEndpointId = null;        // Set after start(), used for relay routing
    this._myId = null;                // Persistent UUID
    this._myAlias = null;             // Display name
    this._myPubKey = null;            // Identity public key
    this._seenRelayIds = new Set();   // Dedup: envelope IDs we've already processed/relayed
    this._relayEnabled = true;
  }

  /**
   * Set our multi-attribute identity so we recognize envelopes addressed to us.
   */
  setMyIdentity({ myId, myAlias, myPubKey, endpointId }) {
    if (myId) this._myId = myId;
    if (myAlias) this._myAlias = myAlias;
    if (myPubKey) this._myPubKey = myPubKey;
    if (endpointId) this._myEndpointId = endpointId;
  }

  /**
   * Check if a target ID addresses this device.
   */
  _isForMe(targetId) {
    if (!targetId) return true; // flood broadcast
    if (targetId === this._myEndpointId) return true;
    if (this._myId && targetId === this._myId) return true;
    if (this._myAlias && targetId === this._myAlias) return true;
    if (this._myPubKey && targetId === this._myPubKey) return true;
    return false;
  }

  /**
   * Register a transport provider.
   * @param {import('./TransportProvider').TransportProvider} transport
   */
  registerTransport(transport) {
    this._transports.push(transport);

    // Wire up lifecycle events from this transport
    transport.onLifecycle({
      onPeerDiscovered: (peer) => {
        this._lifecycleCallbacks.forEach(h => {
          try { h.onPeerDiscovered?.(peer); } catch (e) { console.warn(e); }
        });
      },
      onConnectionRequest: (info) => {
        this._lifecycleCallbacks.forEach(h => {
          try { h.onConnectionRequest?.(info); } catch (e) { console.warn(e); }
        });
      },
      onPeerConnected: (peerId, peerName) => {
        this._connectedPeers.set(peerId, { transport, name: peerName });
        this._lifecycleCallbacks.forEach(h => {
          try { h.onPeerConnected?.(peerId, peerName); } catch (e) { console.warn(e); }
        });
        // Flush any relay queue items destined for this peer
        this._flushRelayQueue(peerId);
      },
      onPeerDisconnected: (peerId) => {
        this._connectedPeers.delete(peerId);
        this._lifecycleCallbacks.forEach(h => {
          try { h.onPeerDisconnected?.(peerId); } catch (e) { console.warn(e); }
        });
      },
      onPeerLost: (endpointId) => {
        this._lifecycleCallbacks.forEach(h => {
          try { h.onPeerLost?.(endpointId); } catch (e) { console.warn(e); }
        });
      },
    });

    // Wire up message receive from this transport
    transport.onReceive((fromPeerId, msg) => {
      this._handleIncoming(fromPeerId, msg, transport);
    });

    console.log(`[RelayEngine] Registered transport: ${transport.getName()}`);
  }

  /**
   * Start all registered transports.
   * @param {string} myName — local device display name
   */
  async startAll(myName) {
    this._myEndpointId = myName;
    for (const t of this._transports) {
      try {
        await t.start(myName);
      } catch (e) {
        console.warn(`[RelayEngine] Failed to start ${t.getName()}:`, e);
      }
    }
  }

  /**
   * Stop all transports.
   */
  async stopAll() {
    for (const t of this._transports) {
      try {
        await t.stop();
      } catch {}
    }
    this._connectedPeers.clear();
  }

  /**
   * Re-trigger discovery on all transports.
   * @param {string} myName
   */
  async restartDiscovery(myName) {
    for (const t of this._transports) {
      try {
        if (typeof t.restartDiscovery === 'function') {
          await t.restartDiscovery(myName);
        } else {
          await t.start(myName);
        }
      } catch (e) {
        console.warn(`[RelayEngine] Discovery restart failed on ${t.getName()}:`, e);
      }
    }
  }

  /**
   * Send a message to a specific peer via the transport that connected to them.
   * @param {string} peerId
   * @param {object|string} message
   * @returns {Promise<boolean>}
   */
  async send(peerId, message) {
    let entry = this._connectedPeers.get(peerId);
    let targetEndpointId = peerId;
    if (!entry) {
      for (const [epId, e] of this._connectedPeers.entries()) {
        if (e.uuid === peerId || (e.alias && e.alias.toLowerCase() === peerId.toLowerCase())) {
          entry = e;
          targetEndpointId = epId;
          break;
        }
      }
    }
    if (entry) {
      return await entry.transport.send(targetEndpointId, message);
    }
    // Try all transports if peer isn't tracked
    for (const t of this._transports) {
      try {
        const ok = await t.send(peerId, message);
        if (ok) return true;
      } catch {}
    }
    return false;
  }

  /**
   * Broadcast a message to all currently connected peers.
   * @param {object|string} message
   * @param {string|null} excludePeerId — optional peer to skip (e.g. the sender)
   */
  async broadcast(message, excludePeerId = null) {
    for (const [peerId, entry] of this._connectedPeers) {
      if (peerId === excludePeerId) continue;
      try {
        await entry.transport.send(peerId, message);
      } catch (e) {
        console.warn(`[RelayEngine] Broadcast to ${peerId} failed:`, e);
      }
    }
  }

  /**
   * Connect to a discovered peer.
   * @param {string} peerId
   * @param {string} myName
   */
  async connectToPeer(peerId, myName) {
    for (const t of this._transports) {
      try {
        await t.connect(peerId, myName);
        return;
      } catch {}
    }
  }

  /**
   * Accept an incoming connection.
   * @param {string} peerId
   */
  async acceptConnection(peerId) {
    for (const t of this._transports) {
      try {
        await t.acceptConnection(peerId);
        return;
      } catch {}
    }
  }

  /**
   * Reject an incoming connection.
   * @param {string} peerId
   */
  async rejectConnection(peerId) {
    for (const t of this._transports) {
      try {
        await t.rejectConnection(peerId);
        return;
      } catch {}
    }
  }

  /**
   * Disconnect from a specific peer.
   * @param {string} peerId
   */
  async disconnectPeer(peerId) {
    const entry = this._connectedPeers.get(peerId);
    if (entry) {
      await entry.transport.disconnect(peerId);
    } else {
      for (const t of this._transports) {
        try { await t.disconnect(peerId); } catch {}
      }
    }
    this._connectedPeers.delete(peerId);
  }

  /**
   * Subscribe to incoming messages (after relay processing).
   * @param {function} callback — (fromPeerId, message) => void
   * @returns {function} unsubscribe
   */
  onMessage(callback) {
    this._messageCallbacks.push(callback);
    return () => {
      this._messageCallbacks = this._messageCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Subscribe to transport lifecycle events.
   * @param {object} handlers
   * @returns {function} unsubscribe
   */
  onLifecycle(handlers) {
    this._lifecycleCallbacks.push(handlers);
    return () => {
      this._lifecycleCallbacks = this._lifecycleCallbacks.filter(h => h !== handlers);
    };
  }

  /**
   * Get all currently connected peer IDs.
   * @returns {string[]}
   */
  getConnectedPeerIds() {
    return [...this._connectedPeers.keys()];
  }

  /**
   * Enable or disable store-and-forward relay.
   * @param {boolean} enabled
   */
  setRelayEnabled(enabled) {
    this._relayEnabled = enabled;
  }

  // ──────────────────────────── Private ────────────────────────────

  /**
   * Handle an incoming message: dispatch to local subscribers,
   * and if it's a relay envelope not for us, forward it.
   */
  _handleIncoming(fromPeerId, msg, sourceTransport) {
    if (!msg || typeof msg !== 'object') {
      // Non-object messages go straight through
      this._dispatchLocal(fromPeerId, msg);
      return;
    }

    // Check if this is a relay envelope (has _relay metadata)
    if (msg._relay) {
      this._handleRelayEnvelope(fromPeerId, msg, sourceTransport);
      return;
    }

    // Normal direct message — dispatch to local subscribers
    this._dispatchLocal(fromPeerId, msg);
  }

  /**
   * Process a relay envelope: if it's for us, unwrap and dispatch;
   * if not, forward to other connected peers.
   */
  _handleRelayEnvelope(fromPeerId, envelope, sourceTransport) {
    const { _relay } = envelope;
    const { id, targetId, ttl, originId } = _relay;

    // Dedup: already seen this envelope?
    if (this._seenRelayIds.has(id)) return;
    this._seenRelayIds.add(id);

    // Prevent memory leak on seen IDs
    if (this._seenRelayIds.size > 5000) {
      const arr = [...this._seenRelayIds];
      this._seenRelayIds = new Set(arr.slice(arr.length - 2500));
    }

    // TTL expired?
    if (ttl !== undefined && ttl <= 0) {
      console.log(`[RelayEngine] Dropping relay envelope ${id}: TTL expired`);
      return;
    }

    // Is this envelope for us (or broadcast)?
    if (this._isForMe(targetId)) {
      // Unwrap and dispatch the inner payload
      const innerMsg = envelope.payload;
      if (innerMsg) {
        this._dispatchLocal(originId || fromPeerId, innerMsg);
      }
      // If targetId is null, it's a flood broadcast — also relay it
      if (!targetId && this._relayEnabled) {
        this._forwardRelay(envelope, fromPeerId);
      }
      return;
    }

    // Not for us — relay forward (multi-hop mesh routing)
    if (this._relayEnabled) {
      this._forwardRelay(envelope, fromPeerId);
    }
  }

  /**
   * Forward a relay envelope to all connected peers except the sender,
   * and store in Data Mule queue for deferred physical transit.
   */
  async _forwardRelay(envelope, excludePeerId) {
    const forwarded = {
      ...envelope,
      _relay: {
        ...envelope._relay,
        ttl: (envelope._relay.ttl ?? MAX_TTL) - 1,
      },
    };

    let deliveredDirectly = false;
    for (const [peerId, entry] of this._connectedPeers) {
      if (peerId === excludePeerId) continue;
      try {
        await entry.transport.send(peerId, forwarded);
        if (forwarded._relay.targetId === peerId) {
          deliveredDirectly = true;
        }
      } catch {}
    }

    // If target is not directly connected, store in Data Mule queue
    if (!deliveredDirectly && forwarded._relay.targetId) {
      await this._queueRelayEnvelope(forwarded);
    }
  }

  /**
   * Save an encrypted envelope into offline storage so this node
   * can act as an oblivious courier (Data Mule) between disconnected peers.
   */
  async _queueRelayEnvelope(envelope) {
    if (!envelope || !envelope._relay?.targetId) return;
    try {
      const raw = await AsyncStorage.getItem(RELAY_QUEUE_KEY);
      const queue = raw ? JSON.parse(raw) : [];
      if (queue.some(e => e._relay?.id === envelope._relay?.id)) return;
      const now = Date.now();
      const valid = queue.filter(e => (now - (e._relay?.ts || 0)) < 48 * 3600 * 1000);
      valid.push(envelope);
      if (valid.length > MAX_RELAY_QUEUE) {
        valid.shift();
      }
      await AsyncStorage.setItem(RELAY_QUEUE_KEY, JSON.stringify(valid));
      console.log(`[RelayEngine] Data Mule: Encrypted envelope queued for offline courier delivery to ${envelope._relay.targetId}`);
    } catch (e) {
      console.warn('[RelayEngine] Error saving Data Mule queue:', e);
    }
  }

  /**
   * Dispatch a message to local subscribers.
   */
  _dispatchLocal(fromPeerId, msg) {
    this._messageCallbacks.forEach(cb => {
      try { cb(fromPeerId, msg); } catch (e) { console.warn(e); }
    });
  }

  /**
   * Flush relay queue: send any stored envelopes destined for a newly-connected peer.
   * Matches by transient endpointId, persistent device UUID, or alias.
   */
  async _flushRelayQueue(peerId, peerUUID = null, peerAlias = null) {
    try {
      const raw = await AsyncStorage.getItem(RELAY_QUEUE_KEY);
      if (!raw) return;
      const queue = JSON.parse(raw);
      const remaining = [];
      const entry = this._connectedPeers.get(peerId);
      if (!entry) return;
      if (peerUUID) entry.uuid = peerUUID;
      if (peerAlias) entry.alias = peerAlias;

      for (const envelope of queue) {
        const target = envelope._relay?.targetId;
        const matches = target && (
          target === peerId ||
          (peerUUID && target === peerUUID) ||
          (peerAlias && target.toLowerCase() === peerAlias.toLowerCase())
        );

        if (matches) {
          try {
            await entry.transport.send(peerId, envelope);
            console.log(`[RelayEngine] Data Mule delivered offline envelope ${envelope._relay?.id} to ${peerId}`);
          } catch {
            remaining.push(envelope);
          }
        } else {
          remaining.push(envelope);
        }
      }
      if (remaining.length > 0) {
        await AsyncStorage.setItem(RELAY_QUEUE_KEY, JSON.stringify(remaining));
      } else {
        await AsyncStorage.removeItem(RELAY_QUEUE_KEY);
      }
    } catch (e) {
      console.warn('[RelayEngine] Failed to flush relay queue:', e);
    }
  }

  /**
   * Public hook to flush relay queue when peer identity attributes (UUID/alias) are resolved.
   */
  async flushRelayQueueForPeer(peerId, peerUUID = null, peerAlias = null) {
    await this._flushRelayQueue(peerId, peerUUID, peerAlias);
  }

  /**
   * Create a relay-wrapped envelope for multi-hop delivery.
   * @param {string} targetPeerId — final destination (null for flood broadcast)
   * @param {object} payload — inner message
   * @param {string} originId — original sender ID
   * @param {number} ttl — hop limit
   * @returns {object} relay envelope
   */
  static createRelayEnvelope(targetPeerId, payload, originId, ttl = MAX_TTL) {
    return {
      _relay: {
        id: `${originId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        targetId: targetPeerId,
        originId,
        ttl,
        ts: Date.now(),
      },
      payload,
    };
  }

  /**
   * Relay a message across the mesh to a multi-hop or non-neighbor peer.
   * Wraps the payload in an opaque relay envelope and broadcasts to all direct neighbors.
   *
   * @param {string} targetPeerId — final destination
   * @param {object} payload — inner message (e.g. encrypted Double Ratchet packet)
   * @param {string} originId — sender ID
   * @param {number} ttl — hop limit
   * @returns {Promise<boolean>}
   */
  async relayToMesh(targetPeerId, payload, originId, ttl = MAX_TTL) {
    const envelope = RelayEngine.createRelayEnvelope(targetPeerId, payload, originId, ttl);
    this._seenRelayIds.add(envelope._relay.id);
    await this.broadcast(envelope);
    return true;
  }
}
