/**
 * NearbyTransport — Google Nearby Connections transport implementation.
 *
 * Wraps the NearbyModule Java native bridge behind the TransportProvider interface.
 * Uses P2P_CLUSTER strategy over BLE + Wi-Fi Direct.
 *
 * Architecture Doc Reference: Section 4.2 (BLETransport + WiFiDirectTransport combined
 * via Google Nearby Connections which uses both radios automatically).
 */
import { NativeModules, NativeEventEmitter, PermissionsAndroid, Platform } from 'react-native';
import { TransportProvider } from './TransportProvider';
import { validatePayloadSize, safeJsonParse } from '../validators';

const { NearbyModule } = NativeModules;
const eventEmitter = NearbyModule ? new NativeEventEmitter(NearbyModule) : null;

const RATE_LIMIT_MAX_PER_SEC = 50;

export class NearbyTransport extends TransportProvider {
  constructor() {
    super();
    this._active = false;
    this._messageSubscribers = [];
    this._lifecycleHandlers = [];
    this._eventSubscriptions = [];
    this._rateLimits = new Map(); // endpointId -> { count, windowStart }
  }

  getName() {
    return 'NearbyConnections';
  }

  getRangeEstimate() {
    return 100; // ~100m per hop (BLE + Wi-Fi Direct)
  }

  isActive() {
    return this._active;
  }

  /**
   * Request all Android permissions required for Nearby Connections.
   */
  async requestPermissions() {
    if (Platform.OS !== 'android') return false;
    try {
      const permissions = [
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      ];

      if (PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS) {
        permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      }
      if (PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES) {
        permissions.push(PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES);
      }
      if (PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN) {
        permissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
        permissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
        permissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE);
      }

      await PermissionsAndroid.requestMultiple(permissions);
      return true;
    } catch (e) {
      console.warn('[NearbyTransport] Permission error:', e);
      return false;
    }
  }

  /**
   * Start advertising + discovery. Sets up all native event listeners.
   * @param {string} myName
   */
  async start(myName) {
    if (!eventEmitter || !NearbyModule) {
      console.warn('[NearbyTransport] NearbyModule Native Module not loaded');
      return;
    }

    await this.requestPermissions();
    this._removeEventListeners();
    this._setupEventListeners();

    try {
      // Clean up any stale/zombie background connections from Google Play Services before starting fresh
      try {
        await NearbyModule.stopAllEndpoints();
      } catch (errStop) {
        console.log('[NearbyTransport] Pre-start cleanup note:', errStop?.message || errStop);
      }
      await new Promise(r => setTimeout(r, 400));

      try {
        await NearbyModule.startAdvertising(myName);
      } catch (errAdv) {
        console.log('[NearbyTransport] Advertising start note:', errAdv?.message || errAdv);
      }
      try {
        await NearbyModule.startDiscovery();
      } catch (errDisc) {
        console.log('[NearbyTransport] Discovery start note:', errDisc?.message || errDisc);
      }
      this._active = true;
      console.log('[NearbyTransport] Advertising & Discovery active');
      setTimeout(() => {
        this.resyncConnections().catch(() => {});
      }, 500);
    } catch (e) {
      console.warn('[NearbyTransport] Start failed:', e);
    }
  }

  async resyncConnections() {
    if (!NearbyModule) return 0;
    try {
      if (NearbyModule.resyncConnectedEndpoints) {
        return await NearbyModule.resyncConnectedEndpoints();
      }
    } catch (e) {
      console.log('[NearbyTransport] Resync note:', e?.message || e);
    }
    return 0;
  }

  async stop() {
    if (!NearbyModule) return;
    try {
      await NearbyModule.stopAllEndpoints();
    } catch {}
    this._removeEventListeners();
    this._active = false;
  }

  async discover(onPeerFound) {
    // Discovery is already running from start(). Register the callback via lifecycle.
    // This method allows re-triggering discovery if it was stopped.
    if (!NearbyModule) return;
    try {
      await NearbyModule.startDiscovery();
    } catch (e) {
      console.warn('[NearbyTransport] Discovery restart failed:', e);
    }
  }

  async restartDiscovery(myName = 'Peer') {
    if (!NearbyModule) return;
    try {
      if (NearbyModule.restartDiscoveryAndAdvertising) {
        await NearbyModule.restartDiscoveryAndAdvertising(myName);
      } else {
        await NearbyModule.stopAllEndpoints();
        await this.start(myName);
      }
    } catch (e) {
      console.warn('[NearbyTransport] Clean restart discovery failed:', e);
    }
  }

  async connect(peerId, myName = 'Peer') {
    if (!NearbyModule) return;
    try {
      await NearbyModule.connectToPeer(peerId, myName);
    } catch (e) {
      console.warn('[NearbyTransport] Connect failed:', e);
    }
  }

  async acceptConnection(peerId) {
    if (!NearbyModule) return;
    try {
      await NearbyModule.acceptConnection(peerId);
    } catch (e) {
      console.warn('[NearbyTransport] Accept failed:', e);
    }
  }

  async rejectConnection(peerId) {
    if (!NearbyModule) return;
    try {
      await NearbyModule.rejectConnection(peerId);
    } catch (e) {
      console.warn('[NearbyTransport] Reject failed:', e);
    }
  }

  async send(peerId, message) {
    if (!NearbyModule) return false;
    try {
      const payload = typeof message === 'string' ? message : JSON.stringify(message);
      await NearbyModule.sendMessage(peerId, payload);
      return true;
    } catch (e) {
      console.warn('[NearbyTransport] Send failed:', e);
      return false;
    }
  }

  async disconnect(peerId) {
    if (!NearbyModule) return;
    try {
      await NearbyModule.disconnectFromEndpoint(peerId);
    } catch (e) {
      console.warn('[NearbyTransport] Disconnect failed:', e);
    }
  }

  onReceive(callback) {
    this._messageSubscribers.push(callback);
    return () => {
      this._messageSubscribers = this._messageSubscribers.filter(cb => cb !== callback);
    };
  }

  onLifecycle(handlers) {
    this._lifecycleHandlers.push(handlers);
    return () => {
      this._lifecycleHandlers = this._lifecycleHandlers.filter(h => h !== handlers);
    };
  }

  // ──────────────────────────── Private ────────────────────────────

  _setupEventListeners() {
    if (!eventEmitter) return;

    // Remove any existing subscriptions first
    this._removeEventListeners();

    const subs = [];

    // Peer discovered
    subs.push(
      eventEmitter.addListener('onPeerDiscovered', (peer) => {
        console.log('[NearbyTransport] Discovered peer:', peer);
        this._lifecycleHandlers.forEach(h => {
          try { h.onPeerDiscovered?.(peer); } catch (e) { console.warn(e); }
        });
      })
    );

    // Peer lost
    subs.push(
      eventEmitter.addListener('onPeerLost', (info) => {
        console.log('[NearbyTransport] Lost peer:', info?.endpointId);
        this._lifecycleHandlers.forEach(h => {
          try { h.onPeerLost?.(info?.endpointId); } catch (e) { console.warn(e); }
        });
      })
    );

    // Connection initiated (incoming pairing request)
    subs.push(
      eventEmitter.addListener('onConnectionInitiated', (info) => {
        console.log('[NearbyTransport] Connection requested:', info);
        this._lifecycleHandlers.forEach(h => {
          try { h.onConnectionRequest?.(info); } catch (e) { console.warn(e); }
        });
      })
    );

    // Connection result
    subs.push(
      eventEmitter.addListener('onConnectionResult', (result) => {
        console.log('[NearbyTransport] Connection result:', result);
        if (result.success) {
          this._lifecycleHandlers.forEach(h => {
            try { h.onPeerConnected?.(result.endpointId, result.endpointName || 'Peer'); } catch (e) { console.warn(e); }
          });
        }
      })
    );

    // Disconnection
    subs.push(
      eventEmitter.addListener('onDisconnected', (info) => {
        console.log('[NearbyTransport] Disconnected from:', info.endpointId);
        this._lifecycleHandlers.forEach(h => {
          try { h.onPeerDisconnected?.(info.endpointId); } catch (e) { console.warn(e); }
        });
      })
    );

    // Message received
    subs.push(
      eventEmitter.addListener('onMessageReceived', (data) => {
        try {
          const endpointId = data.endpointId;

          // Rate limiting check
          const now = Date.now();
          const rate = this._rateLimits.get(endpointId) || { count: 0, windowStart: now };
          if (now - rate.windowStart > 1000) {
            rate.count = 1;
            rate.windowStart = now;
          } else {
            rate.count++;
            if (rate.count > RATE_LIMIT_MAX_PER_SEC) {
              console.warn(`[NearbyTransport] Rate limit exceeded for ${endpointId}, dropping message`);
              return;
            }
          }
          this._rateLimits.set(endpointId, rate);

          let msg = data.message;
          // Validate raw size if string
          if (typeof msg === 'string' && !validatePayloadSize(msg)) {
            console.warn('[NearbyTransport] Dropping oversized message');
            return;
          }

          // Double-parse safety (native bridge may double-stringify)
          if (typeof msg === 'string') {
            msg = safeJsonParse(msg) || msg;
          }
          if (typeof msg === 'string') {
            msg = safeJsonParse(msg) || msg;
          }

          console.log('[NearbyTransport] Incoming message:', msg);
          this._messageSubscribers.forEach(cb => {
            try { cb(endpointId, msg); } catch (e) { console.warn(e); }
          });
        } catch (e) {
          console.warn('[NearbyTransport] Message parse error:', e);
        }
      })
    );

    this._eventSubscriptions = subs;
  }

  _removeEventListeners() {
    this._eventSubscriptions.forEach(sub => {
      try { sub.remove(); } catch {}
    });
    this._eventSubscriptions = [];
  }
}
