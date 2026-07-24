/**
 * AppContext — Global state shared across all screens
 *
 * v2: Integrates ContactManager (Layer 3), X3DH + Double Ratchet (Layer 2),
 * and the transport abstraction (Layer 1).
 *
 * Holds: identity, peers map, sessions, send functions
 */
import React, { createContext, useState, useRef, useEffect } from 'react';
import { Alert, Vibration, Linking, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-get-random-values';

// Crypto (Hybrid Double Ratchet + Direct ECDH)
import {
  initCrypto, exportPublicKey, getMyPreKeyBundle,
  encrypt, decrypt, hasSecret, setPeerPublicKey, getPeerPublicKey,
} from './lib/crypto';

// Pairing / Trust (Layer 3)
import {
  initContactManager, setContactManagerProfile, onPaired,
  sendConnectRequest, handleConnectRequest, handleX3DHResponse,
  acceptRequest, rejectRequest,
  isPaired, getPairedContacts, getPendingRequests, getContact,
  revokePairing, blockPeer, unblockPeer, getBlockedPeers, isBlocked, isPeerTrusted, addTrustedPeer,
  removeTrustedPeer, clearAllTrustedPeers, clearAllPairedContacts, getTrustedPeers,
  updateContactEndpoint,
} from './lib/ContactManager';

// CRDT sync
import { addChat, addBulletin, queuePush, queueDrain, purgeAllCrdtStores, getAdminBroadcasts } from './lib/crdt';

// Group Rooms (Section 10)
import {
  initRoomManager, handleRoomInvite, handleRoomRemoved,
  handleMemberLeft, handleRoomMessage,
} from './lib/RoomManager';
import { handleSenderKeyDistribution } from './lib/crypto/groupCrypto';

// Admin Key Registry & Broadcasts (Section 11)
import { initAdminRegistry, purgeAdminRegistry, getIsAdmin, isMasterAdminDevice } from './lib/AdminKeyRegistry';
import { handleIncomingBroadcast, handleIncomingPromotion } from './lib/BroadcastManager';

// Help Requests (Section 14)
import { handleIncomingHelpRequest, handleIncomingHelpResolution, listActiveRequests } from './lib/HelpRequestManager';

// Transport (via p2p facade)
import {
  sendMessage, subscribeMessages, relayMessage, setMyIdentity,
  connectToPeer, acceptConnection, rejectConnection, disconnectPeer,
  flushRelayQueueForPeer, cleanup, restartDiscovery, resyncConnections,
} from './lib/p2p';

export const AppContext = createContext({});

const STORE_PROFILE = '@dp_my_profile';
const STORE_DEVICE_UUID = '@dp_my_device_uuid';

function genUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function AppProvider({ children }) {
  const [myId, setMyId] = useState(() => genUUID());
  const [myAlias, setMyAlias] = useState('');
  const [myEmoji, setMyEmoji] = useState('🧑');
  const [myPubKey, setMyPubKey] = useState('');
  const [peers, setPeers] = useState(new Map());      // id -> { alias, emoji, connected, hasKey }
  const [discoveredDevices, setDiscoveredDevices] = useState([]);
  const [trustedPeers, setTrustedPeers] = useState(new Set());
  const [initialized, setInitialized] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [pendingPairRequests, setPendingPairRequests] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messageTick, setMessageTick] = useState(0);
  const [incomingSOSCount, setIncomingSOSCount] = useState(0);
  const [latestSOSAlert, setLatestSOSAlert] = useState(null);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [isMasterDevice, setIsMasterDevice] = useState(false);
  const [blockedPeersList, setBlockedPeersList] = useState([]);

  // Refs to guarantee event handlers/callbacks never suffer from stale React state closures
  const myIdRef = useRef(myId);
  const myAliasRef = useRef('');
  const myEmojiRef = useRef('🧑');
  const myPubKeyRef = useRef('');
  const peersRef = useRef(new Map());
  const tabNavigationRef = useRef(null);
  const unsubscribeMessagesRef = useRef(null);
  const pendingPairInitiations = useRef(new Set());

  // Keep refs synchronized with state
  useEffect(() => {
    myIdRef.current = myId;
  }, [myId]);
  useEffect(() => {
    if (myAlias) myAliasRef.current = myAlias;
  }, [myAlias]);
  useEffect(() => {
    if (myEmoji) myEmojiRef.current = myEmoji;
  }, [myEmoji]);
  useEffect(() => {
    if (myPubKey) myPubKeyRef.current = myPubKey;
  }, [myPubKey]);

  useEffect(() => {
    async function syncActiveSOS() {
      try {
        const activeList = await listActiveRequests();
        setIncomingSOSCount(activeList.length);
        setBlockedPeersList(getBlockedPeers());
      } catch {}
    }
    syncActiveSOS();
    const interval = setInterval(syncActiveSOS, 3000);
    return () => clearInterval(interval);
  }, []);

  function openConversation(conv) {
    setActiveConversation(conv);
    if (tabNavigationRef.current?.navigate) {
      tabNavigationRef.current.navigate('Chat');
    }
  }

  function closeConversation() {
    setActiveConversation(null);
  }

  // Load saved local identity and trusted peers on mount.
  useEffect(() => {
    let mounted = true;

    async function bootstrapSavedState() {
      try {
        const [savedProfile, savedId] = await Promise.all([
          AsyncStorage.getItem(STORE_PROFILE),
          AsyncStorage.getItem(STORE_DEVICE_UUID),
          initContactManager(),
        ]);

        if (!mounted) return;

        if (savedId) {
          setMyId(savedId);
          myIdRef.current = savedId;
        }

        let initialAlias = 'Master Admin';
        if (savedProfile) {
          const profile = JSON.parse(savedProfile);
          if (profile?.alias) {
            setMyAlias(profile.alias);
            myAliasRef.current = profile.alias;
            initialAlias = profile.alias;
          }
          if (profile?.emoji) {
            setMyEmoji(profile.emoji);
            myEmojiRef.current = profile.emoji;
          }
        }
        setContactManagerProfile(initialAlias, myEmojiRef.current);

        setTrustedPeers(getTrustedPeers());

        try {
          await initAdminRegistry(initialAlias);
          setIsAdminUser(getIsAdmin());
          const master = await isMasterAdminDevice();
          setIsMasterDevice(master);
        } catch (err) {
          console.warn('[AppContext] Admin init error on mount:', err);
        }

        try {
          const bgVal = await AsyncStorage.getItem('@dp_bg_relay_enabled');
          if (bgVal !== null && NativeModules?.NearbyModule?.setBackgroundRelayEnabled) {
            await NativeModules.NearbyModule.setBackgroundRelayEnabled(bgVal === 'true');
          }
        } catch (bgErr) {
          console.warn('[AppContext] Failed to sync bg relay state on mount:', bgErr);
        }
      } catch (e) {
        console.warn('[AppContext] Failed to load saved profile:', e);
      } finally {
        if (mounted) setProfileLoaded(true);
      }
    }

    bootstrapSavedState();
    return () => { mounted = false; };
  }, []);

  // Subscribe to pairing completion events
  useEffect(() => {
    onPaired((peerId, peerAlias) => {
      console.log(`[AppContext] Pairing completed with ${peerAlias}`);
      setTrustedPeers(getTrustedPeers());
      updatePeers(m => {
        const p = m.get(peerId) || {};
        m.set(peerId, { ...p, hasKey: true, paired: true });
      });
    });
  }, []);

  function updatePeers(updater) {
    const next = new Map(peersRef.current);
    updater(next);
    peersRef.current = next;
    setPeers(new Map(next));
  }

  async function updateProfile(newAlias, newEmoji) {
    const nextAlias = newAlias ? newAlias.trim() : (myAliasRef.current || myAlias);
    const nextEmoji = newEmoji || myEmojiRef.current || myEmoji;
    if (nextAlias) {
      setMyAlias(nextAlias);
      myAliasRef.current = nextAlias;
    }
    if (nextEmoji) {
      setMyEmoji(nextEmoji);
      myEmojiRef.current = nextEmoji;
    }
    setContactManagerProfile(nextAlias || myAliasRef.current || myAlias, nextEmoji);
    await AsyncStorage.setItem(STORE_PROFILE, JSON.stringify({
      alias: nextAlias || myAliasRef.current || myAlias,
      emoji: nextEmoji,
    }));
    setMyIdentity({ myId: myIdRef.current || myId, myAlias: nextAlias || myAliasRef.current || myAlias, myPubKey: myPubKeyRef.current || myPubKey });
  }

  async function initializeApp(alias, emoji) {
    const nextAlias = alias.trim();
    const nextEmoji = emoji || myEmojiRef.current || myEmoji || '🧑';
    setMyAlias(nextAlias);
    myAliasRef.current = nextAlias;
    setMyEmoji(nextEmoji);
    myEmojiRef.current = nextEmoji;
    setContactManagerProfile(nextAlias, nextEmoji);
    await AsyncStorage.setItem(STORE_PROFILE, JSON.stringify({
      alias: nextAlias,
      emoji: nextEmoji,
    }));

    // Stable device UUID
    let currentId = myIdRef.current || myId;
    try {
      const savedId = await AsyncStorage.getItem(STORE_DEVICE_UUID);
      if (savedId) {
        currentId = savedId;
      } else {
        await AsyncStorage.setItem(STORE_DEVICE_UUID, currentId);
      }
      setMyId(currentId);
      myIdRef.current = currentId;
    } catch {}

    // Init crypto (X3DH identity)
    await initCrypto();
    const pub = exportPublicKey();
    setMyPubKey(pub);
    myPubKeyRef.current = pub;

    // Register identity on RelayEngine for multi-hop packet recognition
    setMyIdentity({ myId: currentId, myAlias: nextAlias, myPubKey: pub });
    initContactManager(currentId, nextAlias, nextEmoji);

    // Init Admin Registry & Room Manager
    await initAdminRegistry(nextAlias, pub);
    const adminActive = getIsAdmin();
    setIsAdminUser(adminActive);
    const master = await isMasterAdminDevice();
    setIsMasterDevice(master);
    await initRoomManager();

    // Subscribe to incoming P2P messages
    if (unsubscribeMessagesRef.current) {
      try { unsubscribeMessagesRef.current(); } catch (_) {}
    }
    unsubscribeMessagesRef.current = subscribeMessages(async (fromEndpointId, msg) => {
      await handleIncomingMessage(fromEndpointId, msg, pub, nextAlias, nextEmoji);
    });

    // Auto-resync any radio connections already established at native layer
    setTimeout(() => {
      resyncConnections().catch(() => {});
    }, 400);

    setInitialized(true);
  }

  async function handleIncomingMessage(fromEndpointId, msg, pubKey, alias, emoji) {
    if (!msg || typeof msg !== 'object') return;
    const { type, from, fromAlias, fromEmoji } = msg;
    const peerKey = fromEndpointId || from;
    if (!peerKey) return;

    // Extract public key if attached to this message
    const incomingPubKey = msg.pubKey || msg.preKeyBundle?.identityKey;
    if (incomingPubKey) {
      setPeerPublicKey(peerKey, incomingPubKey);
      if (from) setPeerPublicKey(from, incomingPubKey);
    }

    // Find existing peer if already tracked (by endpointId or by persistent device UUID)
    let existingPeer = peersRef.current.get(peerKey);
    if (!existingPeer && from) {
      for (const [, p] of peersRef.current) {
        if (p.uuid && p.uuid === from) {
          existingPeer = p;
          break;
        }
      }
    }

    const paired = getPairedContacts ? getPairedContacts() : [];
    const matchedContact = paired.find(c => (from && c.uuid === from) || c.peerId === peerKey);

    const cleanFromAlias = fromAlias ? fromAlias.replace(/^[\p{Emoji}\s]+/u, '').trim() : null;
    const cleanDisplayName = cleanFromAlias
      || existingPeer?.alias
      || matchedContact?.alias
      || 'Nearby Peer';
    const cleanAliasKey = cleanDisplayName.toLowerCase();

    updatePeers(m => {
      // Remove any stale duplicate peer with same UUID or same alias (avoiding generic fallback name)
      for (const [existingId, p] of m.entries()) {
        const cleanOld = (p.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
        const sameUUID = Boolean(from && p.uuid && from === p.uuid);
        const sameAlias = Boolean(cleanAliasKey && cleanAliasKey !== 'nearby peer' && cleanOld && cleanAliasKey === cleanOld);
        if (existingId !== peerKey && (sameUUID || sameAlias)) {
          console.log(`[AppContext] Removing stale peer endpoint ${existingId} for reconnecting ${cleanDisplayName}`);
          m.delete(existingId);
        }
      }

      const p = m.get(peerKey) || (from ? [...m.values()].find(x => x.uuid === from) : null) || {};
      m.set(peerKey, {
        id: peerKey,
        endpointId: peerKey,
        uuid: from || p.uuid,
        alias: cleanFromAlias || existingPeer?.alias || matchedContact?.alias || p.alias || 'Nearby Peer',
        emoji: fromEmoji || existingPeer?.emoji || matchedContact?.emoji || p.emoji || '📱',
        connected: true,
        hasKey: Boolean(incomingPubKey) || p.hasKey || false,
      });
    });

    switch (type) {
      // ─── v2 Protocol: Connect Request ───
      case 'CONNECT_REQUEST': {
        console.log(`[AppContext] Connect request from ${cleanDisplayName}`);
        await handleConnectRequest(peerKey, msg);
        // Refresh pending requests for UI
        setPendingPairRequests(getPendingRequests());
        break;
      }

      // ─── v2 Protocol: X3DH Response ───
      case 'X3DH_RESPONSE': {
        console.log(`[AppContext] X3DH response from ${peerKey}`);
        await handleX3DHResponse(peerKey, msg);
        setTrustedPeers(getTrustedPeers());
        setMessageTick(t => t + 1);
        break;
      }

      // ─── Mutual Pairing Confirmation ───
      case 'PAIR_ACK': {
        console.log(`[AppContext] PAIR_ACK received from ${peerKey}`);
        setTrustedPeers(getTrustedPeers());
        setPendingPairRequests(getPendingRequests());
        setMessageTick(t => t + 1);
        break;
      }

      // ─── Pairing Revocation ───
      case 'REVOKE_PAIRING': {
        console.log(`[AppContext] Peer ${cleanDisplayName} revoked pairing`);
        await revokePairing(peerKey);
        if (from) await revokePairing(from);
        if (cleanDisplayName) await revokePairing(cleanDisplayName);
        setTrustedPeers(getTrustedPeers());
        setPendingPairRequests(getPendingRequests());
        try {
          await disconnectPeer(peerKey);
        } catch {}
        updatePeers(m => {
          m.delete(peerKey);
          for (const [epId, p] of m.entries()) {
            if ((from && p.uuid === from) || (cleanDisplayName && p.alias === cleanDisplayName)) {
              m.delete(epId);
            }
          }
        });
        setTimeout(() => {
          restartDiscovery(myAliasRef.current || myAlias || 'Peer').catch(() => {});
        }, 500);
        setMessageTick(t => t + 1);
        break;
      }

      // ─── Handshake: HELLO ───
      case 'HELLO': {
        const peerUUID = msg.from;
        if (peerUUID) {
          await updateContactEndpoint(peerUUID, peerKey, cleanDisplayName);
          await flushRelayQueueForPeer(peerKey, peerUUID, cleanDisplayName);
        }
        // Respond with our public key & pre-key bundle
        const bundle = getMyPreKeyBundle();
        const currentAlias = myAliasRef.current || myAlias || 'Peer';
        const cleanMyAlias = currentAlias.replace(/^[\p{Emoji}\s]+/u, '').trim() || currentAlias;
        await sendMessage(peerKey, {
          type: 'HELLO_ACK',
          from: myIdRef.current || myId,
          fromAlias: cleanMyAlias,
          fromEmoji: myEmojiRef.current || myEmoji,
          pubKey: myPubKeyRef.current || myPubKey,
          preKeyBundle: bundle,
        });
        await flushQueue(peerKey, cleanDisplayName, fromEmoji);
        await syncRecentAdminBroadcasts(peerKey);
        setMessageTick(t => t + 1);
        break;
      }

      // ─── Handshake: HELLO_ACK ───
      case 'HELLO_ACK': {
        console.log(`[AppContext] HELLO_ACK received from ${peerKey} (${fromAlias})`);
        const peerUUID = msg.from;
        if (peerUUID) {
          await updateContactEndpoint(peerUUID, peerKey, cleanDisplayName);
          await flushRelayQueueForPeer(peerKey, peerUUID, cleanDisplayName);
        }
        await flushQueue(peerKey, cleanDisplayName, fromEmoji);
        await syncRecentAdminBroadcasts(peerKey);
        setMessageTick(t => t + 1);
        break;
      }

      // ─── v2 Protocol: KEY_BUNDLE ───
      case 'KEY_BUNDLE': {
        if (msg.preKeyBundle) {
          await handleConnectRequest(peerKey, {
            ...msg,
            type: 'CONNECT_REQUEST',
            requestId: `auto-${Date.now()}`,
          });
          setPendingPairRequests(getPendingRequests());
        }
        break;
      }

      // ─── v1 Compat: KEY (old ECDH exchange) ───
      case 'KEY': {
        if (msg.pubKey) {
          await setPeerPublicKey(peerKey, msg.pubKey);
          if (from) await setPeerPublicKey(from, msg.pubKey);
          updatePeers(m => {
            const p = m.get(peerKey) || {};
            m.set(peerKey, { ...p, hasKey: true });
          });
        }
        break;
      }

      // ─── Chat Message (Direct or Multi-Hop Relay) ───
      case 'MSG': {
        const senderId = msg.from || peerKey;
        const senderAlias = msg.fromAlias || '';

        // Drop message immediately if sender is blacklisted/blocked
        if (isBlocked(peerKey) || (msg.from && isBlocked(msg.from))) {
          console.log(`[AppContext] Dropped message from blocked device: ${senderId}`);
          break;
        }

        // Strictly verify that sender is in paired contacts before accepting direct chat
        const senderIsPaired = isPaired(peerKey) || (msg.from && isPaired(msg.from)) || (senderAlias && isPaired(senderAlias));
        if (!senderIsPaired) {
          console.log(`[AppContext] Blocked direct chat from unpaired stranger: ${senderAlias || senderId}`);
          break;
        }

        let plain = null;
        const senderPubKey = msg.pubKey || msg.preKeyBundle?.identityKey;
        if (senderPubKey) {
          await setPeerPublicKey(peerKey, senderPubKey);
          if (msg.from) await setPeerPublicKey(msg.from, senderPubKey);
        }

        if (msg.ct && msg.iv) {
          plain = await decrypt(peerKey, msg.header, msg.iv, msg.ct, senderPubKey);
          if (!plain || plain === '[decrypt error]') {
            if (msg.from && msg.from !== peerKey) {
              plain = await decrypt(msg.from, msg.header, msg.iv, msg.ct, senderPubKey);
            }
          }
          if (!plain || plain === '[decrypt error]') {
            if (senderPubKey) {
              plain = await decrypt(senderPubKey, msg.header, msg.iv, msg.ct, senderPubKey);
            }
          }
        }

        // Plaintext fallback
        if (!plain || plain === '[decrypt error]') {
          if (msg.text) plain = msg.text;
        }

        if (!plain || plain === '[decrypt error]') {
          console.warn('[AppContext] Could not decrypt incoming message from', senderId);
          plain = '[Encrypted Message]';
        }

        const m = {
          id: msg.id,
          from: senderId,
          alias: msg.fromAlias || 'Nearby Peer',
          text: plain,
          ts: msg.ts || Date.now(),
          targetId: myId, // Explicitly mark as addressed to me locally
        };
        await addChat(m);
        setMessageTick(t => t + 1);
        break;
      }

      // ─── Bulletin Post ───
      case 'BULLETIN': {
        let plain = msg.text;
        if (!plain && msg.header && msg.ct) {
          try {
            plain = await decrypt(peerKey, msg.header, msg.iv, msg.ct);
          } catch {}
        }
        if (!plain) return;

        const p = {
          id: msg.id || genUUID(),
          from: msg.from || peerKey,
          alias: msg.fromAlias || 'Mesh Peer',
          text: plain,
          category: msg.category || 'INFO',
          ts: msg.ts || Date.now(),
        };
        const newlyAdded = await addBulletin(p);
        if (newlyAdded) {
          setMessageTick(t => t + 1);
          // Re-flood to other connected peers across the mesh
          for (const [otherId] of peersRef.current.entries()) {
            if (otherId !== peerKey && otherId !== msg.from) {
              try { await sendMessage(otherId, msg); } catch {}
            }
          }
        }
        break;
      }

      // ─── Room Sender Key Distribution ───
      case 'SENDER_KEY_DIST': {
        await handleSenderKeyDistribution(peerKey, msg);
        setMessageTick(t => t + 1);
        break;
      }

      case 'ROOM_KEY_REQUEST': {
        if (msg.roomId) {
          const myCurrentId = myIdRef.current || myId;
          await distributeSenderKey(msg.roomId, peerKey, myCurrentId);
        }
        break;
      }

      // ─── Room Membership ───
      case 'ROOM_INVITE': {
        await handleRoomInvite(peerKey, msg, myId, alias);
        break;
      }

      case 'ROOM_REMOVED': {
        await handleRoomRemoved(msg);
        break;
      }

      case 'ROOM_MEMBER_LEFT': {
        await handleMemberLeft(peerKey, msg);
        break;
      }

      // ─── Room Message ───
      case 'ROOM_MSG': {
        await handleRoomMessage(peerKey, msg);
        setMessageTick(t => t + 1);
        break;
      }

      // ─── Admin Broadcast & Promotion ───
      case 'ADMIN_BROADCAST': {
        const added = await handleIncomingBroadcast(peerKey, msg, peersRef.current);
        if (added) {
          setMessageTick(t => t + 1);
        }
        break;
      }

      case 'ADMIN_PROMOTION': {
        await handleIncomingPromotion(peerKey, msg, peersRef.current);
        setMessageTick(t => t + 1);
        break;
      }

      // ─── Help Request & Resolution ───
      case 'HELP_REQUEST': {
        const reqData = await handleIncomingHelpRequest(peerKey, msg, peersRef.current);
        if (reqData) {
          setLatestSOSAlert(reqData);
          try {
            // SOS vibration pattern (distinct alert pulses)
            Vibration.vibrate([0, 600, 200, 600, 200, 600, 200, 1000]);
          } catch {}

          try {
            const activeList = await listActiveRequests();
            setIncomingSOSCount(activeList.length);
          } catch {}

          const urgLabel = reqData.urgencyType ? reqData.urgencyType.toUpperCase() : 'EMERGENCY';
          const sender = reqData.alias || 'Mesh Peer';
          const tierStr = reqData.tier === 'circle' ? 'Trusted Contact' : 'Mesh Broadcast';
          const noteStr = reqData.note ? `\n\n📝 "${reqData.note}"` : '';
          const locStr = reqData.location
            ? `\n📍 ${reqData.location.lat.toFixed(3)}, ${reqData.location.lng.toFixed(3)}${reqData.location.approx ? ' (~100m)' : ''}`
            : '';

          const alertButtons = [
            { text: 'Dismiss', style: 'cancel' },
          ];

          if (reqData.location?.lat != null && reqData.location?.lng != null) {
            const { lat, lng } = reqData.location;
            alertButtons.push({
              text: 'Google Maps 🗺️',
              onPress: () => {
                setLatestSOSAlert(null);
                const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
                Linking.openURL(url).catch(() => {});
              },
            });
          }

          alertButtons.push({
            text: 'View SOS 🆘',
            style: 'destructive',
            onPress: () => {
              setLatestSOSAlert(null);
              if (tabNavigationRef.current?.navigate) {
                tabNavigationRef.current.navigate('Help');
              }
            },
          });

          Alert.alert(
            '🚨 EMERGENCY SOS ALERT',
            `A distress signal was received!\n\nFrom: ${sender} (${tierStr})\nUrgency: ${urgLabel}${noteStr}${locStr}`,
            alertButtons,
            { cancelable: false }
          );
        }
        break;
      }

      case 'HELP_RESOLVED': {
        await handleIncomingHelpResolution(peerKey, msg, peersRef.current);
        try {
          const activeList = await listActiveRequests();
          setIncomingSOSCount(activeList.length);
        } catch {}
        break;
      }

      case 'RESOURCE_SYNC': {
        try {
          const { action, resource, resourceId } = msg;
          const raw = await AsyncStorage.getItem('@dp_resource_pins');
          let currentList = raw ? JSON.parse(raw) : [];
          if (action === 'ADD' && resource) {
            currentList = [resource, ...currentList.filter(r => r.id !== resource.id)];
          } else if (action === 'DELETE' && resourceId) {
            currentList = currentList.filter(r => r.id !== resourceId);
          }
          await AsyncStorage.setItem('@dp_resource_pins', JSON.stringify(currentList));
          setMessageTick(t => t + 1);
        } catch (e) {
          console.warn('[AppContext] Error syncing resource:', e);
        }
        break;
      }
    }
  }

  async function broadcastHello(alias, emoji, pubKey) {
    const bundle = getMyPreKeyBundle();
    const currentAlias = alias || myAliasRef.current || myAlias || 'Peer';
    const cleanAlias = currentAlias.replace(/^[\p{Emoji}\s]+/u, '').trim() || currentAlias;
    for (const [peerId] of peersRef.current) {
      await sendMessage(peerId, {
        type: 'HELLO', from: myIdRef.current || myId,
        fromAlias: cleanAlias,
        fromEmoji: emoji || myEmojiRef.current || myEmoji,
        pubKey: pubKey || myPubKeyRef.current || myPubKey,
        preKeyBundle: bundle,
      });
    }
  }

  async function sendChatMessage(text, targetPeerId = null, targetAlias = null) {
    const msgId   = genUUID();
    const msgTs   = Date.now();
    const currentAlias = myAliasRef.current || myAlias || 'Peer';
    const cleanMyAlias = currentAlias.replace(/^[\p{Emoji}\s]+/u, '').trim() || currentAlias;

    // Find active connected endpoint for target
    let directEndpointId = null;
    let canonicalTargetId = targetPeerId;
    if (targetPeerId) {
      if (peersRef.current.has(targetPeerId)) {
        directEndpointId = targetPeerId;
        const p = peersRef.current.get(targetPeerId);
        if (p && p.uuid) canonicalTargetId = p.uuid;
      } else {
        for (const [epId, p] of peersRef.current) {
          if (epId === targetPeerId || p.id === targetPeerId || p.uuid === targetPeerId || p.endpointId === targetPeerId) {
            directEndpointId = epId;
            if (p.uuid) canonicalTargetId = p.uuid;
            break;
          }
        }
      }
    }

    const contact = getContact(canonicalTargetId) || getContact(targetPeerId) || (directEndpointId ? getContact(directEndpointId) : null);
    if (contact?.uuid) canonicalTargetId = contact.uuid;

    const msg     = {
      id: msgId,
      from: myIdRef.current || myId,
      alias: cleanMyAlias,
      text,
      ts: msgTs,
      targetId: canonicalTargetId || targetPeerId,
      targetEndpointId: directEndpointId,
      targetAlias: targetAlias || null,
    };
    await addChat(msg);
    setMessageTick(t => t + 1);

    let delivered = false;
    const targetPubKey = contact?.identityKey || (directEndpointId ? getPeerPublicKey(directEndpointId) : null) || getPeerPublicKey(targetPeerId);

    if (targetPeerId && !directEndpointId) {
      // ─── Multi-Hop 1:1 Chat via Mesh Relay (B -> A -> X) ───
      const encTarget = contact?.uuid || contact?.peerId || targetPeerId;
      const enc = await encrypt(encTarget, text, targetPubKey);

      const payload = {
        type: 'MSG', id: msgId, from: myId, fromAlias: cleanMyAlias, fromEmoji: myEmoji,
        pubKey: myPubKey,
        ts: msgTs, targetId: targetPeerId,
        header: enc?.header, iv: enc?.iv, ct: enc?.ct,
        text: enc ? undefined : text,
      };

      await relayMessage(targetPeerId, payload, myId);
      delivered = true;
    } else if (directEndpointId) {
      // ─── Direct 1-hop to connected peer endpoint ───
      const enc = await encrypt(directEndpointId, text, targetPubKey);
      const payload = {
        type: 'MSG', id: msgId, from: myId, fromAlias: cleanMyAlias, fromEmoji: myEmoji,
        pubKey: myPubKey,
        ts: msgTs, targetId: targetPeerId,
        header: enc?.header, iv: enc?.iv, ct: enc?.ct,
        text: enc ? undefined : text,
      };

      const ok = await sendMessage(directEndpointId, payload);
      if (ok) delivered = true;
    } else {
      // ─── Broadcast to all connected peers ───
      for (const [peerId] of peersRef.current) {
        const enc = await encrypt(peerId, text);
        const payload = {
          type: 'MSG', id: msgId, from: myId, fromAlias: cleanMyAlias, fromEmoji: myEmoji,
          pubKey: myPubKey,
          ts: msgTs, targetId: null,
          header: enc?.header, iv: enc?.iv, ct: enc?.ct,
          text: enc ? undefined : text,
        };

        const ok = await sendMessage(peerId, payload);
        if (ok) delivered = true;
      }
    }

    if (!delivered) {
      await queuePush({ kind: 'chat', id: msgId, text, alias: cleanMyAlias, ts: msgTs });
    }
  }

  async function sendBulletin(text, category) {
    const postId  = genUUID();
    const postTs  = Date.now();
    const currentAlias = myAliasRef.current || myAlias || 'Peer';
    const cleanMyAlias = currentAlias.replace(/^[\p{Emoji}\s]+/u, '').trim() || currentAlias;
    const post    = { id: postId, from: myIdRef.current || myId, alias: cleanMyAlias, text, category, ts: postTs };
    await addBulletin(post);

    const payload = {
      type: 'BULLETIN',
      id: postId,
      from: myId,
      fromAlias: cleanMyAlias,
      category,
      ts: postTs,
      text,
    };

    for (const [peerId] of peersRef.current.entries()) {
      try {
        await sendMessage(peerId, payload);
      } catch (e) {
        console.warn(`[AppContext] Failed to send bulletin to ${peerId}:`, e);
      }
    }
  }

  async function syncRecentAdminBroadcasts(peerId) {
    try {
      const recents = await getAdminBroadcasts();
      const toSend = recents.slice(0, 10);
      const currentAlias = myAliasRef.current || myAlias || 'Peer';
      const cleanMyAlias = currentAlias.replace(/^[\p{Emoji}\s]+/u, '').trim() || currentAlias;
      for (const post of toSend) {
        await sendMessage(peerId, {
          type: 'ADMIN_BROADCAST',
          from: myIdRef.current || myId,
          fromAlias: cleanMyAlias,
          post,
        });
      }
    } catch (e) {
      console.log('[AppContext] Admin broadcast sync note:', e?.message || e);
    }
  }

  async function flushQueue(peerId, alias, emoji) {
    const queued = await queueDrain();
    for (const item of queued) {
      if (item.kind === 'chat') {
        const enc = await encrypt(peerId, item.text);
        let payload;
        if (enc) {
          payload = {
            type: 'MSG', id: item.id, from: myId, fromAlias: item.alias,
            ts: item.ts,
            header: enc.header, iv: enc.iv, ct: enc.ct,
          };
        } else {
          payload = {
            type: 'MSG', id: item.id, from: myId, fromAlias: item.alias,
            ts: item.ts, text: item.text,
          };
        }
        await sendMessage(peerId, payload);
      } else if (item.kind === 'admin_broadcast' && item.post) {
        const currentAlias = myAliasRef.current || myAlias || 'Peer';
        const cleanMyAlias = currentAlias.replace(/^[\p{Emoji}\s]+/u, '').trim() || currentAlias;
        await sendMessage(peerId, {
          type: 'ADMIN_BROADCAST',
          from: myIdRef.current || myId,
          fromAlias: cleanMyAlias,
          post: item.post,
        });
      }
    }
  }

  function handlePeerConnected(peerId, peerName) {
    const rawClean = (peerName || '').replace(/^[\p{Emoji}\s]+/u, '').trim();
    const isGeneric = !rawClean || rawClean.toLowerCase() === 'peer' || rawClean.toLowerCase() === 'nearby peer';

    // Check if discovered earlier via radio beacons
    const discovered = discoveredDevices.find(d => (d.endpointId === peerId || d.deviceAddress === peerId));
    const discoveredClean = (discovered?.endpointName || discovered?.deviceName || '').replace(/^[\p{Emoji}\s]+/u, '').trim();
    const isDiscoveredGeneric = !discoveredClean || discoveredClean.toLowerCase() === 'peer' || discoveredClean.toLowerCase() === 'nearby peer';

    // Check if we already know this peer from our paired contacts
    const paired = getPairedContacts ? getPairedContacts() : [];
    const matchedContact = paired.find(c => {
      const cClean = (c.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
      return (!isGeneric && cClean && rawClean.toLowerCase() === cClean) || c.peerId === peerId;
    });

    const existingPeer = peersRef.current.get(peerId);

    const cleanNewName = (!isGeneric ? rawClean : null)
      || matchedContact?.alias
      || (!isDiscoveredGeneric ? discoveredClean : null)
      || existingPeer?.alias
      || (!isGeneric ? rawClean : null)
      || 'Nearby Peer';
    const cleanNewLower = cleanNewName.toLowerCase();

    updatePeers(m => {
      // Remove any stale duplicate peer with same name
      if (cleanNewLower && cleanNewLower !== 'nearby peer' && cleanNewLower !== 'peer') {
        for (const [existingId, p] of m.entries()) {
          const cleanOld = (p.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
          if (existingId !== peerId && cleanOld === cleanNewLower) {
            console.log(`[AppContext] Removing stale peer endpoint ${existingId} for reconnecting ${peerName}`);
            m.delete(existingId);
          }
        }
      }

      m.set(peerId, {
        id: peerId,
        endpointId: peerId,
        uuid: matchedContact?.uuid || null,
        alias: cleanNewName,
        emoji: matchedContact?.emoji || discovered?.emoji || '📱',
        connected: true,
        hasKey: Boolean(matchedContact?.identityKey),
      });
    });

    if (matchedContact?.uuid) {
      updateContactEndpoint(matchedContact.uuid, peerId, cleanNewName).catch(() => {});
      flushRelayQueueForPeer(peerId, matchedContact.uuid, cleanNewName).catch(() => {});
    }

    // If this connection was initiated by a pair request from the UI, send the CONNECT_REQUEST immediately
    if (pendingPairInitiations.current.has(peerId)) {
      pendingPairInitiations.current.delete(peerId);
      setTimeout(() => {
        sendConnectRequest(peerId, myAliasRef.current || myAlias, myEmojiRef.current || myEmoji || '👤', myIdRef.current || myId).catch(() => {});
      }, 300);
    }

    // Flush any pending messages & sync recent admin broadcasts to this newly connected node
    setTimeout(() => {
      flushQueue(peerId, cleanNewName, matchedContact?.emoji).catch(() => {});
      syncRecentAdminBroadcasts(peerId).catch(() => {});
    }, 400);

    // Send HELLO with pre-key bundle and public key
    const bundle = getMyPreKeyBundle();
    const currentAlias = myAliasRef.current || myAlias || 'Peer';
    const cleanMyAlias = currentAlias.replace(/^[\p{Emoji}\s]+/u, '').trim() || currentAlias;
    sendMessage(peerId, {
      type: 'HELLO',
      from: myIdRef.current || myId,
      fromAlias: cleanMyAlias,
      fromEmoji: myEmojiRef.current || myEmoji,
      pubKey: myPubKeyRef.current || myPubKey,
      preKeyBundle: bundle,
    });
    setMessageTick(t => t + 1);
  }

  function handlePeerDisconnected(peerId) {
    if (!peerId) return;
    autoConnectAttempts.current.delete(peerId);
    pendingPairInitiations.current.delete(peerId);
    updatePeers(m => {
      m.delete(peerId);
    });
    setMessageTick(t => t + 1);
  }

  const autoConnectAttempts = useRef(new Map());

  function onDeviceDiscovered(device) {
    const epId = device.endpointId || device.deviceAddress;
    const peerName = device.endpointName || device.deviceName || '';
    const cleanName = (peerName || '').replace(/^[\p{Emoji}\s]+/u, '').trim();
    const cleanLower = cleanName.toLowerCase();

    setDiscoveredDevices(prev => {
      const filtered = prev.filter(d => {
        const dEp = d.deviceAddress || d.endpointId;
        if (dEp === epId) return false;
        const cleanOld = (d.endpointName || d.deviceName || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
        if (cleanLower && cleanOld && cleanLower === cleanOld) return false;
        return true;
      });
      return [...filtered, device];
    });

    // Check if peer is blocked
    if (isBlocked(epId) || isBlocked(cleanName)) {
      return;
    }

    // Auto-connect to form the radio mesh link (for Admin Broadcasts, SOS alerts, and public mesh relay)
    if (epId && !peersRef.current.has(epId)) {
      const paired = getPairedContacts ? getPairedContacts() : [];
      const isTrustedFriend = paired.some(c => {
        const cClean = (c.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
        return (cleanLower && cClean && cleanLower === cClean) || c.peerId === epId;
      });

      const myCleanAlias = (myAliasRef.current || myAlias || 'Peer').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
      const myIdVal = myIdRef.current || myId || '';

      // Deterministic tie-breaker:
      // Compare aliases alphabetically. If identical, compare device IDs.
      let isInitiator = false;
      if (myCleanAlias !== cleanLower) {
        isInitiator = myCleanAlias > cleanLower;
      } else {
        isInitiator = myIdVal > (device.uuid || epId);
      }

      // Admin devices always take high priority as initiator so announcements and broadcasts reach nodes quickly
      const amAdmin = isAdminUser || isMasterDevice || (getIsAdmin && getIsAdmin());
      if (amAdmin) {
        isInitiator = true;
      }

      const now = Date.now();
      const lastAttempt = autoConnectAttempts.current.get(epId) || 0;

      // Initiator attempts after 3.5s - 5s; non-initiator fallback after 10s - 12s
      const retryCooldown = isInitiator
        ? (isTrustedFriend || amAdmin ? 3000 : 4500)
        : (isTrustedFriend ? 9000 : 12000);

      if (now - lastAttempt > retryCooldown) {
        autoConnectAttempts.current.set(epId, now);
        console.log(`[AppContext] Auto-connecting mesh peer [trusted=${isTrustedFriend}, admin=${amAdmin}, initiator=${isInitiator}]: ${cleanName} (${epId})`);
        connectToPeer(epId, myAliasRef.current || myAlias || 'Peer').catch(e => {
          console.log(`[AppContext] Auto-connect to ${epId} deferred:`, e?.message || e);
        });
      }
    }
  }

  function onDeviceLost(lostEndpointId) {
    if (!lostEndpointId) return;
    autoConnectAttempts.current.delete(lostEndpointId);
    pendingPairInitiations.current.delete(lostEndpointId);
    // Note: Do NOT remove device from discoveredDevices here!
    // Android BLE cycling fires onEndpointLost every 14-15 seconds to save radio power.
    // Preserving the device keeps it consistently visible so the user can pair smoothly at any time.
    console.log(`[AppContext] Device lost event for: ${lostEndpointId} (preserving in list)`);
  }

  async function requestPairWithPeer(peerId) {
    if (!peerId) return;
    const currentAlias = myAliasRef.current || myAlias || 'Peer';
    if (peersRef.current.get(peerId)?.connected) {
      await sendConnectRequest(peerId, currentAlias, myEmojiRef.current || myEmoji || '👤', myIdRef.current || myId);
    } else {
      pendingPairInitiations.current.add(peerId);
      // Auto-clear pending initiation after 15s if connection fails to materialize
      setTimeout(() => {
        pendingPairInitiations.current.delete(peerId);
      }, 15000);
      try {
        await connectToPeer(peerId, currentAlias);
      } catch (err) {
        const errMsg = String(err?.message || err || '');
        if (errMsg.includes('8003') || errMsg.includes('ALREADY_CONNECTED')) {
          console.log(`[AppContext] Peer ${peerId} already connected on radio level, dispatching pair request immediately`);
          pendingPairInitiations.current.delete(peerId);
          await sendConnectRequest(peerId, currentAlias, myEmojiRef.current || myEmoji || '👤', myIdRef.current || myId);
          return;
        }
        pendingPairInitiations.current.delete(peerId);
        throw err;
      }
    }
  }

  // ─── Incoming Connection / Mesh Radio Link Handler ───
  async function handleIncomingConnectionRequest(info) {
    const { endpointId, endpointName } = info;
    const cleanName = (endpointName || '').replace(/^[\p{Emoji}\s]+/u, '').trim() || endpointName || 'Nearby Peer';

    if (isBlocked(endpointId) || isBlocked(cleanName)) {
      console.log(`[AppContext] Rejected incoming connection from blocked node: ${cleanName} (${endpointId})`);
      try {
        await rejectConnection(endpointId);
      } catch {}
      return;
    }

    console.log(`[AppContext] Auto-accepting radio mesh link for node: ${cleanName} (${endpointId})`);
    try {
      await acceptConnection(endpointId);
    } catch (e) {
      console.warn(`[AppContext] Error accepting radio connection from ${endpointId}:`, e);
    }
  }

  // ─── Pairing Request Handlers (exposed for UI) ───

  async function acceptPairRequest(requestId) {
    const allPending = getPendingRequests();
    const req = allPending.find(r => r.requestId === requestId) || pendingPairRequests.find(r => r.requestId === requestId);
    if (req) {
      await acceptRequest(req);
      setPendingPairRequests(getPendingRequests());
      setTrustedPeers(getTrustedPeers());
      setMessageTick(t => t + 1);
    }
  }

  async function rejectPairRequest(requestId) {
    await rejectRequest(requestId);
    setPendingPairRequests(getPendingRequests());
  }

  async function handleClearAllPairedContacts() {
    // Disconnect active radio endpoints
    for (const [peerId] of peersRef.current.entries()) {
      try {
        await disconnectPeer(peerId);
      } catch {}
    }
    await clearAllPairedContacts();
    peersRef.current = new Map();
    setPeers(new Map());
    setTrustedPeers(new Set());
    setPendingPairRequests([]);
    setDiscoveredDevices([]);
    setMessageTick(t => t + 1);
  }

  async function handleUnpairPeer(peerId, uuid = null, alias = null) {
    const currentAlias = myAliasRef.current || myAlias || 'Peer';
    const cleanMyAlias = currentAlias.replace(/^[\p{Emoji}\s]+/u, '').trim() || currentAlias;
    try {
      const payload = { type: 'REVOKE_PAIRING', from: myIdRef.current || myId, fromAlias: cleanMyAlias };
      if (peerId && peersRef.current.has(peerId)) {
        await sendMessage(peerId, payload);
      } else {
        for (const [epId, p] of peersRef.current.entries()) {
          if (epId === peerId || (uuid && p.uuid === uuid) || (alias && p.alias === alias)) {
            await sendMessage(epId, payload);
            break;
          }
        }
      }
    } catch (e) {
      console.warn('[AppContext] Could not transmit REVOKE_PAIRING to peer:', e);
    }

    // Give socket 250ms to flush REVOKE_PAIRING packet over radio before disconnecting
    await new Promise(r => setTimeout(r, 250));

    if (peerId) await revokePairing(peerId);
    if (uuid) await revokePairing(uuid);
    if (alias) await revokePairing(alias);

    // Also disconnect physical radio link so re-pairing starts fresh
    if (peerId) {
      try {
        await disconnectPeer(peerId);
      } catch {}
    }
    for (const [epId, p] of peersRef.current.entries()) {
      if (epId === peerId || (uuid && p.uuid === uuid) || (alias && p.alias === alias)) {
        try {
          await disconnectPeer(epId);
        } catch {}
      }
    }

    updatePeers(m => {
      if (peerId) m.delete(peerId);
      for (const [epId, p] of m.entries()) {
        if ((uuid && p.uuid === uuid) || (alias && p.alias === alias)) {
          m.delete(epId);
        }
      }
    });

    setTrustedPeers(getTrustedPeers());
    setPendingPairRequests(getPendingRequests());

    // Keep discoveredDevices intact so the newly unpaired device remains immediately visible
    // with a "➕ Pair" button under "Nearby Devices", avoiding reliance on OS cache expiry.
    autoConnectAttempts.current.clear();

    // Clean restart discovery so newly unpaired devices are immediately rediscovered
    setTimeout(() => {
      restartDiscovery(myAliasRef.current || myAlias || 'Peer').catch(() => {});
    }, 400);

    setMessageTick(t => t + 1);
    console.log(`[AppContext] Unpaired peer ${alias || uuid || peerId} and synchronized state`);
  }

  async function handleBlockPeer(peerId, uuid = null, alias = null) {
    if (peerId) await blockPeer(peerId);
    if (uuid) await blockPeer(uuid);
    if (alias) await blockPeer(alias);
    await handleUnpairPeer(peerId, uuid, alias);
    if (peerId && peersRef.current.has(peerId)) {
      try { await disconnectPeer(peerId); } catch {}
    }
    setBlockedPeersList(getBlockedPeers());
    setMessageTick(t => t + 1);
  }

  async function handleUnblockPeer(peerIdOrAlias) {
    if (!peerIdOrAlias) return;
    await unblockPeer(peerIdOrAlias);
    setBlockedPeersList(getBlockedPeers());
    setMessageTick(t => t + 1);
  }

  async function handlePanicWipe() {
    console.log('[AppContext] Executing EMERGENCY NUCLEAR PANIC WIPE...');
    try {
      cleanup();
      if (NativeModules?.NearbyModule?.stopAllEndpoints) {
        await NativeModules.NearbyModule.stopAllEndpoints();
      }
    } catch {}

    for (const [peerId] of peersRef.current.entries()) {
      try {
        await disconnectPeer(peerId);
      } catch {}
    }

    try {
      await clearAllPairedContacts();
    } catch {}

    try {
      await purgeAllCrdtStores();
    } catch {}

    try {
      await purgeAdminRegistry();
    } catch {}

    try {
      await AsyncStorage.clear();
    } catch {}

    peersRef.current = new Map();
    setPeers(new Map());
    setTrustedPeers(new Set());
    setPendingPairRequests([]);
    setDiscoveredDevices([]);
    setActiveConversation(null);
    setLatestSOSAlert(null);
    setMyAlias('');
    setMyEmoji('🧑');
    setInitialized(false);
    setProfileLoaded(true);
    setMessageTick(t => t + 1);
  }

  return (
    <AppContext.Provider value={{
      myId, myAlias, myEmoji, myPubKey,
      peers, discoveredDevices, trustedPeers,
      initialized, profileLoaded, pendingPairRequests,
      initializeApp, broadcastHello,
      sendChatMessage, sendBulletin,
      onDeviceDiscovered,
      onDeviceLost,
      handlePeerConnected, handlePeerDisconnected,
      handleIncomingConnectionRequest,
      requestPairWithPeer,
      restartDiscovery,
      // v2: ContactManager functions
      addTrustedPeer, removeTrustedPeer,
      unpairPeer: handleUnpairPeer,
      blockPeer: handleBlockPeer,
      unblockPeer: handleUnblockPeer,
      blockedPeersList,
      clearAllTrustedPeers: handleClearAllPairedContacts,
      clearAllPairedContacts: handleClearAllPairedContacts,
      panicWipe: handlePanicWipe,
      isPeerTrusted,
      isPaired, getPairedContacts, revokePairing,
      acceptPairRequest, rejectPairRequest,
      sendConnectRequest: (peerId) => sendConnectRequest(peerId, myAliasRef.current || myAlias, myEmojiRef.current || myEmoji, myIdRef.current || myId),
      // Modern Conversation & Hub Navigation
      activeConversation, setActiveConversation,
      openConversation, closeConversation,
      messageTick, tabNavigationRef,
      incomingSOSCount,
      latestSOSAlert,
      dismissSOSAlert: () => setLatestSOSAlert(null),
      updateProfile,
      isAdmin: isAdminUser,
      isMasterDevice,
      setIsAdminUser,
    }}>
      {children}
    </AppContext.Provider>
  );
}
