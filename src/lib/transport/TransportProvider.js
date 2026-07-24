/**
 * TransportProvider — Abstract base class for mesh transport implementations.
 *
 * All relay logic is written against this interface. Any radio — BLE, Wi-Fi Direct,
 * LoRa, or Ham radio — implements the same interface, so adding a new radio never
 * requires touching the pairing, encryption, or sync layers above it.
 *
 * Architecture Doc Reference: Section 4.1
 */

export class TransportProvider {
  /**
   * Human-readable name of this transport (e.g. 'NearbyConnections', 'LoRa').
   * @returns {string}
   */
  getName() {
    throw new Error('TransportProvider.getName() must be implemented');
  }

  /**
   * Estimated range in meters for a single hop over this transport.
   * @returns {number}
   */
  getRangeEstimate() {
    throw new Error('TransportProvider.getRangeEstimate() must be implemented');
  }

  /**
   * Whether this transport is currently active and ready to send/receive.
   * @returns {boolean}
   */
  isActive() {
    throw new Error('TransportProvider.isActive() must be implemented');
  }

  /**
   * Start advertising + discovery on this transport.
   * @param {string} myName — the local device's display name
   * @returns {Promise<void>}
   */
  async start(myName) {
    throw new Error('TransportProvider.start() must be implemented');
  }

  /**
   * Stop all activity on this transport.
   * @returns {Promise<void>}
   */
  async stop() {
    throw new Error('TransportProvider.stop() must be implemented');
  }

  /**
   * Begin scanning for nearby peers.
   * @param {function} onPeerFound — callback({endpointId, endpointName, ...})
   * @returns {Promise<void>}
   */
  async discover(onPeerFound) {
    throw new Error('TransportProvider.discover() must be implemented');
  }

  /**
   * Request a connection to a discovered peer.
   * @param {string} peerId — endpoint/device ID
   * @param {string} myName — local device name to advertise
   * @returns {Promise<void>}
   */
  async connect(peerId, myName) {
    throw new Error('TransportProvider.connect() must be implemented');
  }

  /**
   * Accept an incoming connection request.
   * @param {string} peerId
   * @returns {Promise<void>}
   */
  async acceptConnection(peerId) {
    throw new Error('TransportProvider.acceptConnection() must be implemented');
  }

  /**
   * Reject an incoming connection request.
   * @param {string} peerId
   * @returns {Promise<void>}
   */
  async rejectConnection(peerId) {
    throw new Error('TransportProvider.rejectConnection() must be implemented');
  }

  /**
   * Send bytes/message to a connected peer.
   * @param {string} peerId
   * @param {string|object} message — string or JSON-serializable object
   * @returns {Promise<boolean>} true if sent successfully
   */
  async send(peerId, message) {
    throw new Error('TransportProvider.send() must be implemented');
  }

  /**
   * Disconnect from a specific peer.
   * @param {string} peerId
   * @returns {Promise<void>}
   */
  async disconnect(peerId) {
    throw new Error('TransportProvider.disconnect() must be implemented');
  }

  /**
   * Subscribe to incoming messages from any connected peer.
   * @param {function} callback — (fromPeerId, message) => void
   * @returns {function} unsubscribe function
   */
  onReceive(callback) {
    throw new Error('TransportProvider.onReceive() must be implemented');
  }

  /**
   * Subscribe to connection lifecycle events.
   * @param {object} handlers
   * @param {function} handlers.onConnectionRequest  — (info) => void
   * @param {function} handlers.onPeerConnected      — (peerId, peerName) => void
   * @param {function} handlers.onPeerDisconnected   — (peerId) => void
   * @param {function} handlers.onPeerDiscovered     — (peer) => void
   * @returns {function} unsubscribe function
   */
  onLifecycle(handlers) {
    throw new Error('TransportProvider.onLifecycle() must be implemented');
  }
}
