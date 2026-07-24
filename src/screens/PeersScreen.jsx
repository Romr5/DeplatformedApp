import React, { useState, useContext, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
  ScrollView,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppContext } from '../AppContext';
import { connectToPeer, disconnectPeer, startDiscovery } from '../lib/p2p';
import { getIsAdmin, isAdminKey } from '../lib/AdminKeyRegistry';
import { promoteContact } from '../lib/BroadcastManager';
import { isPaired, blockPeer, sendConnectRequest } from '../lib/ContactManager';
import { colors, radii } from '../theme';
import { TopBar } from '../components/layout/TopBar';
import { Badge } from '../components/ui/Badge';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import RadarSweep from '../components/RadarSweep';
import SettingsScreen from './SettingsScreen';
import {
  IconRadioTower,
  IconWifi,
  IconWifiOff,
  IconRadio,
  IconChats,
  IconTrash,
  IconShield,
  IconSatellite,
  IconDoor,
  IconGear,
  IconMoreVertical,
} from '../icons/Icons';

export default function PeersScreen({ navigation }) {
  const {
    peers,
    discoveredDevices,
    myAlias,
    myEmoji,
    myId,
    removeTrustedPeer,
    clearAllPairedContacts,
    getPairedContacts,
    revokePairing,
    unpairPeer,
    openConversation,
    acceptPairRequest,
    rejectPairRequest,
    pendingPairRequests,
    blockPeer,
    unblockPeer,
    requestPairWithPeer,
  } = useContext(AppContext);

  const insets = useSafeAreaInsets();
  const [contacts, setContacts] = useState([]);
  const [scanning, setScanning] = useState(true);
  const [showRadarVisual, setShowRadarVisual] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [selectedPeerForConnect, setSelectedPeerForConnect] = useState(null);

  const seenPeerKeys = new Set();
  const connectedPeers = [...peers.values()].filter((p) => {
    if (!p.connected) return false;
    const clean = (p.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase() || p.uuid || p.id;
    if (seenPeerKeys.has(clean)) return false;
    seenPeerKeys.add(clean);
    return true;
  });

  const seenAvail = new Set();
  const available = discoveredDevices.filter((d) => {
    const epId = d.endpointId || d.deviceAddress;
    const peerInMap = peers.get(epId);
    if (peerInMap && peerInMap.connected) return false;
    const clean = (d.endpointName || d.deviceName || '').trim().toLowerCase();
    if (seenPeerKeys.has(clean) || seenAvail.has(clean)) return false;
    seenAvail.add(clean);
    return true;
  });

  useEffect(() => {
    loadContacts();
    const interval = setInterval(loadContacts, 2000);
    return () => clearInterval(interval);
  }, []);

  function loadContacts() {
    if (getPairedContacts) {
      setContacts(getPairedContacts());
    }
  }

  function handleToggleScan() {
    if (!scanning) {
      startDiscovery(myAlias).catch(() => {});
      setScanning(true);
    } else {
      setScanning(false);
    }
  }

  function handleConnectClick(d) {
    setSelectedPeerForConnect(d);
  }

  async function handleConfirmConnect() {
    if (!selectedPeerForConnect) return;
    const peerId = selectedPeerForConnect.endpointId || selectedPeerForConnect.deviceAddress;
    const peerName = selectedPeerForConnect.endpointName || selectedPeerForConnect.deviceName || 'Peer';
    setSelectedPeerForConnect(null);

    if (peerId) {
      try {
        if (requestPairWithPeer) {
          await requestPairWithPeer(peerId);
        } else {
          await connectToPeer(peerId, myAlias);
          await sendConnectRequest(peerId, myAlias, myEmoji || '👤', myId);
        }
        Alert.alert(
          'Connecting & Pairing',
          `Establishing secure radio link with "${peerName}". A pairing approval prompt has been sent to their device.`
        );
      } catch (e) {
        Alert.alert('Connection Error', e.message || 'Failed to connect');
      }
    }
  }

  function handleDisconnect(item) {
    const pid = item.endpointId || item.id;
    Alert.alert('Disconnect Radio', `Disconnect direct radio link with ${item.alias || 'Peer'}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          if (pid) await disconnectPeer(pid);
        },
      },
    ]);
  }

  function handleUnpair(c) {
    Alert.alert('Unpair Contact', `Revoke pairing trust for ${c.alias || 'Peer'}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unpair',
        style: 'destructive',
        onPress: async () => {
          if (unpairPeer) {
            await unpairPeer(c.peerId || c.endpointId || c.id, c.uuid, c.alias);
          } else {
            const pid = c.peerId || c.endpointId || c.uuid || c.id;
            if (pid) {
              await removeTrustedPeer(pid);
              await revokePairing(pid);
            }
          }
          loadContacts();
        },
      },
    ]);
  }

  async function handleRequestPair(peer) {
    const epId = peer.endpointId || peer.id;
    try {
      if (requestPairWithPeer) {
        await requestPairWithPeer(epId);
      } else {
        await sendConnectRequest(epId, myAlias, myEmoji || '👤', myId);
      }
      Alert.alert('Pair Request Sent', `Sent pairing request to "${peer.alias}". They must accept to enable direct messaging.`);
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not send pair request');
    }
  }

  function handleBlock(peer) {
    const pid = peer.endpointId || peer.uuid || peer.id;
    Alert.alert('Block Device', `Block ${peer.alias || 'Peer'}? They will be blacklisted and cannot message or pair with you.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: async () => {
          if (blockPeer) {
            await blockPeer(pid, peer.uuid, peer.alias);
          }
          loadContacts();
          Alert.alert('Blocked', `${peer.alias || 'Peer'} has been blocked.`);
        },
      },
    ]);
  }

  function handleShowPeerOptions(peer, paired, isPeerAdmin) {
    const peerName = peer.alias || 'Peer';
    const buttons = [
      { text: 'Cancel', style: 'cancel' },
    ];

    if (paired) {
      buttons.push({
        text: '💬 Open Direct Chat',
        onPress: () => handleOpenChat(peer),
      });
      buttons.push({
        text: '🗑️ Unpair Friend',
        style: 'destructive',
        onPress: () => handleUnpair(peer),
      });
    } else {
      buttons.push({
        text: '➕ Send Pair Request',
        onPress: () => handleRequestPair(peer),
      });
    }

    if (iAmAdmin && !isPeerAdmin && paired) {
      buttons.push({
        text: '🛡️ Promote to Administrator',
        onPress: () => handlePromote(peer),
      });
    }

    buttons.push({
      text: '🚫 Block Device',
      style: 'destructive',
      onPress: () => handleBlock(peer),
    });

    Alert.alert(peerName, 'Manage device connection & trust:', buttons);
  }

  function handleResetAll() {
    Alert.alert(
      'Reset Trust Circle',
      'Remove all saved contacts and cryptographic trust memory?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset All',
          style: 'destructive',
          onPress: async () => {
            await clearAllPairedContacts();
            setContacts([]);
          },
        },
      ]
    );
  }

  function handleOpenChat(item) {
    const pid = item.peerId || item.endpointId || item.id;
    openConversation({
      type: 'direct',
      id: pid,
      peerId: pid,
      uuid: item.uuid,
      title: item.alias || item.endpointName || 'Direct Peer',
      peer: item,
    });
  }

  async function handlePromote(peer) {
    const peerKey = peer.endpointId || peer.id;
    Alert.alert(
      'Promote to Admin',
      `Grant "${peer.alias}" administrator rights to sign official notices?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Promote',
          onPress: async () => {
            try {
              await promoteContact(peerKey, peer.alias, peer.signingKey || peerKey, myId, peers);
              Alert.alert('Success', `${peer.alias} is now a Mesh Administrator.`);
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          },
        },
      ]
    );
  }

  const iAmAdmin = getIsAdmin();
  const totalVisible = connectedPeers.length + available.length;

  return (
    <View style={styles.container}>
      <TopBar
        title="Mesh Network"
        subtitle="Decentralized P2P Infrastructure"
        onMapPress={() => navigation?.navigate ? navigation.navigate('Map') : null}
        rightAction={
          <Pressable
            onPress={() => navigation?.navigate ? navigation.navigate('Settings') : setShowSettingsModal(true)}
            style={({ pressed }) => [styles.settingsBtn, pressed && styles.btnPressed]}
            hitSlop={6}
          >
            <IconGear size={18} color={colors.textSecondary} />
          </Pressable>
        }
        onEmergencyPress={() => navigation?.navigate && navigation.navigate('Help')}
      />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 24) + 80 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Global Mesh Status Card (DML Signature) */}
        <View style={styles.statusCard}>
          <View style={styles.statusCardHeader}>
            <Text style={styles.statusCardTitle}>Network Status</Text>
            <View style={styles.statusActiveWrap}>
              <View style={styles.pingDotWrap}>
                <View style={styles.pingDotOuter} />
                <View style={styles.pingDotInner} />
              </View>
              <Text style={styles.statusActiveText}>ACTIVE</Text>
            </View>
          </View>

          <View style={styles.metricsGrid}>
            <View style={styles.metricBox}>
              <Text style={styles.metricVal}>{totalVisible}</Text>
              <Text style={styles.metricLabel}>VISIBLE NODES</Text>
            </View>
            <View style={styles.metricBox}>
              <Text style={[styles.metricVal, { color: colors.signal }]}>{connectedPeers.length}</Text>
              <Text style={styles.metricLabel}>ACTIVE RELAYS</Text>
            </View>
          </View>

          <View style={styles.radarToggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.radarToggleTitle}>BLE & Wi-Fi Direct Sweeper</Text>
              <Text style={styles.radarToggleSub}>
                {scanning ? 'Broadcasting & discovering nearby radios' : 'Discovery paused'}
              </Text>
            </View>
            <Button
              variant="outline"
              size="sm"
              onPress={handleToggleScan}
            >
              {scanning ? 'Scanning' : 'Scan'}
            </Button>
          </View>

          {showRadarVisual && (
            <View style={styles.radarVisualWrap}>
              <RadarSweep scanning={scanning} />
            </View>
          )}

          <Pressable
            onPress={() => setShowRadarVisual(!showRadarVisual)}
            style={styles.expandVisualBtn}
          >
            <Text style={styles.expandVisualText}>
              {showRadarVisual ? '▲ Hide Radar Visualizer' : '▼ Show Radar Visualizer'}
            </Text>
          </Pressable>
        </View>

        {/* Pending Pair Requests (If Any) */}
        {pendingPairRequests && pendingPairRequests.length > 0 && (
          <View style={styles.sectionWrap}>
            <Text style={styles.sectionHeading}>INCOMING PAIR REQUESTS ({pendingPairRequests.length})</Text>
            {pendingPairRequests.map((req, idx) => {
              const reqAlias = req.peerAlias || req.fromAlias || 'Nearby Peer';
              return (
                <View key={req.requestId || idx} style={styles.pairRequestCard}>
                  <Avatar fallback={reqAlias} size="default" tint={colors.amber} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.peerName}>{reqAlias}</Text>
                    <Text style={styles.peerSub}>Wants to pair for direct encrypted messaging</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Button
                      size="sm"
                      variant="danger"
                      onPress={() => rejectPairRequest(req.requestId)}
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      onPress={() => acceptPairRequest(req.requestId)}
                    >
                      Accept
                    </Button>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Nearby Devices (Active Connected + Discovered) */}
        <View style={styles.sectionWrap}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeading}>NEARBY DEVICES</Text>
            <Text style={styles.sectionSubCount}>{totalVisible} nearby</Text>
          </View>

          {totalVisible === 0 ? (
            <View style={styles.emptyState}>
              <IconRadioTower size={32} color={colors.textMuted} />
              <Text style={styles.emptyStateTitle}>No devices detected nearby</Text>
              <Text style={styles.emptyStateSub}>
                Ensure nearby phones have Deplatformed open with Wi-Fi and Bluetooth enabled.
              </Text>
            </View>
          ) : (
            <View style={styles.peerList}>
              {/* Connected Active Peers */}
              {connectedPeers.map((peer, idx) => {
                const peerKey = peer.endpointId || peer.id;
                const isPeerAdmin = isAdminKey(peerKey);
                const paired = isPaired(peerKey, peer.alias) || (peer.uuid && isPaired(peer.uuid, peer.alias));

                return (
                  <View key={`conn-${idx}`} style={styles.peerCard}>
                    <Avatar fallback={peer.alias || 'P'} size="default" tint={paired ? colors.signal : colors.amber} />
                    <View style={styles.peerInfo}>
                      <View style={styles.peerNameRow}>
                        <Text style={styles.peerName} numberOfLines={1}>{peer.alias || 'Mesh Peer'}</Text>
                        <Badge variant={paired ? 'success' : 'outline'} style={styles.statusPill}>
                          {paired ? 'Paired' : 'Unpaired'}
                        </Badge>
                      </View>
                      <View style={styles.signalRow}>
                        <IconWifi size={13} color={paired ? colors.signal : colors.amber} />
                        <Text style={styles.signalText} numberOfLines={1}>
                          {paired ? 'Direct Link • E2E Encrypted' : 'Radio Relay • Unpaired'}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.peerActions}>
                      {paired ? (
                        <Button
                          size="sm"
                          variant="default"
                          style={{ paddingHorizontal: 12 }}
                          onPress={() => handleOpenChat(peer)}
                        >
                          💬 Chat
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          style={{ paddingHorizontal: 10 }}
                          onPress={() => handleRequestPair(peer)}
                        >
                          ➕ Pair
                        </Button>
                      )}
                      <Pressable
                        onPress={() => handleShowPeerOptions(peer, paired, isPeerAdmin)}
                        style={styles.moreActionBtn}
                        hitSlop={8}
                      >
                        <IconMoreVertical size={18} color={colors.textSecondary} />
                      </Pressable>
                    </View>
                  </View>
                );
              })}

              {/* Discovered Unconnected Peers */}
              {available.map((d, idx) => (
                <View key={`disc-${idx}`} style={styles.peerCard}>
                  <Avatar fallback={d.endpointName || d.deviceName || 'D'} size="default" tint={colors.textSecondary} />
                  <View style={styles.peerInfo}>
                    <Text style={styles.peerName}>
                      {d.endpointName || d.deviceName || 'Discovered Radio'}
                    </Text>
                    <View style={styles.signalRow}>
                      <IconRadio size={14} color={colors.amber} />
                      <Text style={styles.signalText}>Discovered via Radio • Unpaired</Text>
                    </View>
                  </View>
                  <Button
                    size="sm"
                    variant="outline"
                    onPress={() => handleConnectClick(d)}
                  >
                    ➕ Pair
                  </Button>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Trust Circle / Saved Contacts */}
        <View style={styles.sectionWrap}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeading}>TRUST CIRCLE ({contacts.length})</Text>
            {contacts.length > 0 && (
              <Pressable onPress={handleResetAll}>
                <Text style={styles.resetText}>Reset All</Text>
              </Pressable>
            )}
          </View>

          {contacts.length === 0 ? (
            <View style={styles.emptyTrustBox}>
              <Text style={styles.emptyTrustText}>
                No saved trusted peers. Paired friends will appear here with zero-prompt auto-reconnect memory.
              </Text>
            </View>
          ) : (
            <View style={styles.peerList}>
              {contacts.map((c, idx) => (
                <View key={`trust-${idx}`} style={styles.peerCard}>
                  <Avatar fallback={c.alias || 'C'} size="default" tint={colors.amber} />
                  <View style={styles.peerInfo}>
                    <Text style={styles.peerName}>{c.alias || 'Trusted Friend'}</Text>
                    <Text style={styles.peerSub}>Auto-Reconnect Authorized</Text>
                  </View>
                  <Pressable
                    onPress={() => handleUnpair(c)}
                    style={styles.unpairBtn}
                    hitSlop={8}
                  >
                    <IconTrash size={15} color={colors.textMuted} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Connection Confirmation Modal (DML Style) */}
      <Modal
        isOpen={Boolean(selectedPeerForConnect)}
        onClose={() => setSelectedPeerForConnect(null)}
        title="Pair With Nearby Node"
      >
        {selectedPeerForConnect && (
          <View style={styles.connectModalBody}>
            <Avatar
              fallback={selectedPeerForConnect.endpointName || selectedPeerForConnect.deviceName || 'P'}
              size="lg"
              tint={colors.amber}
              style={{ marginBottom: 14 }}
            />
            <Text style={styles.connectModalTitle}>
              {selectedPeerForConnect.endpointName || selectedPeerForConnect.deviceName || 'Nearby Peer'}
            </Text>
            <Text style={styles.connectModalSub}>
              Send a secure pairing request to this device over offline radio. They will receive a prompt on their device to approve before connection.
            </Text>
            <View style={styles.modalBtnRow}>
              <Button
                variant="secondary"
                style={{ flex: 1 }}
                onPress={() => setSelectedPeerForConnect(null)}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                style={{ flex: 1 }}
                onPress={handleConfirmConnect}
              >
                Send Request 📡
              </Button>
            </View>
          </View>
        )}
      </Modal>

      {/* Settings Modal (Preserves all Settings functions) */}
      <Modal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        title="System Settings"
      >
        <SettingsScreen onBack={() => setShowSettingsModal(false)} />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    padding: 16,
    gap: 18,
  },
  settingsBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.lg,
    padding: 16,
    gap: 14,
  },
  statusCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusCardTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  statusActiveWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pingDotWrap: {
    width: 8,
    height: 8,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pingDotOuter: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(245, 158, 11, 0.4)',
  },
  pingDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.amber,
  },
  statusActiveText: {
    color: colors.amber,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  metricBox: {
    flex: 1,
    backgroundColor: colors.zinc950,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: 12,
  },
  metricVal: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginTop: 4,
  },
  radarToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  radarToggleTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  radarToggleSub: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 1,
  },
  radarVisualWrap: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  expandVisualBtn: {
    alignItems: 'center',
    paddingTop: 4,
  },
  expandVisualText: {
    color: colors.amber,
    fontSize: 11,
    fontWeight: '600',
  },
  sectionWrap: {
    gap: 10,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  sectionHeading: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionSubCount: {
    color: colors.textMuted,
    fontSize: 11,
  },
  resetText: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: '600',
  },
  peerList: {
    gap: 8,
  },
  peerCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.lg,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pairRequestCard: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    borderRadius: radii.lg,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  peerInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  peerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  peerName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
  },
  statusPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  peerSub: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  signalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  signalText: {
    color: colors.textMuted,
    fontSize: 11,
    flexShrink: 1,
  },
  peerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  moreActionBtn: {
    padding: 8,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminActionBtn: {
    padding: 6,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  disconnectBtn: {
    padding: 6,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  unpairBtn: {
    padding: 8,
  },
  emptyState: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.lg,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyStateTitle: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  emptyStateSub: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
    maxWidth: 280,
  },
  emptyTrustBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.lg,
    padding: 16,
  },
  emptyTrustText: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
  },
  connectModalBody: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  connectModalTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  connectModalSub: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
    maxWidth: 280,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  btnPressed: {
    opacity: 0.7,
  },
});
