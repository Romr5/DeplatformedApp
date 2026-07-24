import React, { useState, useContext, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  Switch,
  NativeModules,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppContext } from '../AppContext';
import {
  getIsAdmin,
  getAdminCount,
  becomeAdmin,
  getMySigningKey,
  isMasterAdminDevice,
} from '../lib/AdminKeyRegistry';
import { colors, radii } from '../theme';
import { TopBar } from '../components/layout/TopBar';
import { Badge } from '../components/ui/Badge';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import {
  IconKey,
  IconShieldCheck,
  IconTrash,
  IconLock,
  IconCheck,
  IconCopy,
  IconSatellite,
  IconBattery,
  IconRadioTower,
} from '../icons/Icons';

const STORE_SOS_APPROX = '@dp_sos_approx';
const STORE_RELAY_ENABLED = '@dp_relay_enabled';
const STORE_BG_RELAY_ENABLED = '@dp_bg_relay_enabled';

export default function SettingsScreen({ onBack }) {
  const insets = useSafeAreaInsets();
  const {
    myId,
    myAlias,
    myEmoji,
    myPubKey,
    peers,
    updateProfile,
    clearAllPairedContacts,
    clearAllTrustedPeers,
    panicWipe,
    getPairedContacts,
    removeTrustedPeer,
    revokePairing,
    unpairPeer,
    blockedPeersList,
    unblockPeer,
  } = useContext(AppContext);

  const [editAlias, setEditAlias] = useState(myAlias || '');
  const [approxLocation, setApproxLocation] = useState(true);
  const [relayEnabled, setRelayEnabled] = useState(true);
  const [bgRelayEnabled, setBgRelayEnabled] = useState(true);
  const [copiedKey, setCopiedKey] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [adminCount, setAdminCount] = useState(0);
  const [signingKey, setSigningKey] = useState(null);
  const [pairedList, setPairedList] = useState([]);
  const [isMasterDevice, setIsMasterDevice] = useState(false);

  useEffect(() => {
    isMasterAdminDevice().then(setIsMasterDevice);
    AsyncStorage.getItem(STORE_SOS_APPROX).then((val) => {
      if (val !== null) setApproxLocation(val === 'true');
    });
    AsyncStorage.getItem(STORE_RELAY_ENABLED).then((val) => {
      if (val !== null) setRelayEnabled(val === 'true');
    });
    AsyncStorage.getItem(STORE_BG_RELAY_ENABLED).then((val) => {
      if (val !== null) setBgRelayEnabled(val === 'true');
    });
    loadAdminStatus();
    loadPairedContacts();
    const interval = setInterval(loadPairedContacts, 2000);
    return () => clearInterval(interval);
  }, [peers]);

  function loadAdminStatus() {
    setIsAdminUser(getIsAdmin());
    setAdminCount(getAdminCount());
    setSigningKey(getMySigningKey());
  }

  function loadPairedContacts() {
    if (getPairedContacts) {
      setPairedList(getPairedContacts());
    }
  }

  async function handleSaveProfile() {
    const trimmed = editAlias.trim();
    if (!trimmed) {
      Alert.alert('Invalid Name', 'Please enter a valid display name.');
      return;
    }
    await updateProfile(trimmed, myEmoji || '👤');
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  }

  async function handleToggleApprox(val) {
    setApproxLocation(val);
    await AsyncStorage.setItem(STORE_SOS_APPROX, val ? 'true' : 'false');
  }

  async function handleToggleRelay(val) {
    setRelayEnabled(val);
    await AsyncStorage.setItem(STORE_RELAY_ENABLED, val ? 'true' : 'false');
  }

  async function handleToggleBgRelay(val) {
    setBgRelayEnabled(val);
    await AsyncStorage.setItem(STORE_BG_RELAY_ENABLED, val ? 'true' : 'false');
    if (NativeModules?.NearbyModule?.setBackgroundRelayEnabled) {
      try {
        await NativeModules.NearbyModule.setBackgroundRelayEnabled(val);
      } catch (e) {
        console.warn('[Settings] Failed to set background relay:', e);
      }
    }
  }

  function handleCopyKey() {
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  }

  async function handleClaimAdmin() {
    Alert.alert(
      'Claim Genesis Admin Access',
      `Establish "${myAlias || 'My Device'}" as the primary verified mesh administrator with ECDSA P-256 signing keys?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Become Genesis Admin',
          onPress: async () => {
            try {
              await becomeAdmin(myAlias || 'Admin', myPubKey || myId);
              loadAdminStatus();
              Alert.alert('Success', 'This device is now the verified Genesis Administrator.');
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          },
        },
      ]
    );
  }

  function handleUnpairSingle(c) {
    Alert.alert('Unpair Contact', `Revoke trust for ${c.alias || 'Peer'}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unpair',
        style: 'destructive',
        onPress: async () => {
          if (unpairPeer) {
            await unpairPeer(c.peerId, c.uuid, c.alias);
          } else {
            const pid = c.peerId || c.uuid || c.id;
            if (pid) {
              await removeTrustedPeer(pid);
              await revokePairing(pid);
            }
          }
          loadPairedContacts();
        },
      },
    ]);
  }

  function handleResetTrust() {
    Alert.alert(
      'Reset Trust Circle',
      'Remove all paired contacts and authorization keys from memory?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset All',
          style: 'destructive',
          onPress: async () => {
            if (clearAllPairedContacts) {
              await clearAllPairedContacts();
            } else if (clearAllTrustedPeers) {
              await clearAllTrustedPeers();
            }
            setPairedList([]);
            loadPairedContacts();
            Alert.alert('Reset Complete', 'All paired authorizations have been cleared.');
          },
        },
      ]
    );
  }

  function handlePanicWipe() {
    Alert.alert(
      'Emergency Data Wipe',
      'This will immediately purge all encrypted message stores, identity keys, group rooms, and cached radio logs from this device.\n\nAre you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Wipe Everything',
          style: 'destructive',
          onPress: async () => {
            try {
              if (panicWipe) {
                await panicWipe();
              } else {
                await AsyncStorage.clear();
              }
              setPairedList([]);
              if (onBack) onBack();
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          },
        },
      ]
    );
  }

  const connectedCount = [...peers.values()].filter((p) => p.connected).length;

  return (
    <View style={styles.container}>
      <TopBar
        title="Settings"
        subtitle="Identity & Mesh Diagnostics"
        onBack={onBack}
        showEmergency={false}
      />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) + 85 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Section (DML Signature) */}
        <View style={styles.card}>
          <Text style={styles.sectionHeader}>USER PROFILE</Text>
          <View style={styles.profileRow}>
            <Avatar fallback={editAlias || 'M'} size="lg" tint={colors.amber} />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <TextInput
                style={styles.aliasInput}
                value={editAlias}
                onChangeText={setEditAlias}
                placeholder="Your Display Alias"
                placeholderTextColor={colors.textMuted}
                maxLength={24}
              />
              <Text style={styles.subtext}>Visible to nearby devices on BLE & Wi-Fi Direct</Text>
            </View>
          </View>

          <Button
            variant="default"
            size="sm"
            onPress={handleSaveProfile}
            style={{ marginTop: 12 }}
            icon={isSaved ? <IconCheck size={16} color={colors.white} /> : null}
          >
            {isSaved ? 'Profile Updated ✓' : 'Save Changes'}
          </Button>
        </View>

        {/* Administrator Access Card */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.rowWithIcon}>
              <IconShieldCheck size={18} color={isAdminUser ? colors.amber : colors.textMuted} />
              <Text style={styles.sectionHeader}>MESH ADMINISTRATOR ACCESS</Text>
            </View>
            <Badge variant={isAdminUser ? 'warning' : 'outline'}>
              {isAdminUser ? '★ GENESIS ADMIN' : 'STANDARD NODE'}
            </Badge>
          </View>

          <Text style={styles.cardDesc}>
            {isAdminUser
              ? 'This device possesses the Genesis ECDSA cryptographic keypair and can broadcast verified network notices across the mesh.'
              : 'Mesh administrators sign official emergency bulletins that verify across all offline devices.'}
          </Text>

          {!isAdminUser && isMasterDevice ? (
            <Button
              variant="default"
              size="sm"
              onPress={handleClaimAdmin}
              style={{ marginTop: 8 }}
            >
              Claim Genesis Admin Status
            </Button>
          ) : isAdminUser ? (
            <Text style={[styles.subtext, { marginTop: 6, color: colors.amber }]}>
              Verified Genesis Authority Active • Authorized to sign and broadcast emergency alerts.
            </Text>
          ) : (
            <Text style={[styles.subtext, { marginTop: 6, fontStyle: 'italic' }]}>
              Standard Node • Administration rights are issued exclusively by verified Mesh Administrators.
            </Text>
          )}
        </View>

        {/* Network & Power (DML Feature) */}
        <View style={styles.card}>
          <View style={styles.rowWithIcon}>
            <IconBattery size={18} color={relayEnabled ? colors.amber : colors.textMuted} />
            <Text style={styles.sectionHeader}>NETWORK & POWER</Text>
          </View>

          <View style={styles.settingRow}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={styles.settingTitle}>Act as Mesh Relay</Text>
              <Text style={styles.subtext}>
                Store and forward encrypted packets for nearby peers (uses battery)
              </Text>
            </View>
            <Switch
              value={relayEnabled}
              onValueChange={handleToggleRelay}
              trackColor={{ false: colors.surfaceAlt, true: colors.amberDark }}
              thumbColor={colors.white}
            />
          </View>

          <View style={[styles.settingRow, { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.hairline }]}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={styles.settingTitle}>Run in Background</Text>
              <Text style={styles.subtext}>
                Keep radio listening when app is minimized or closed in recent apps
              </Text>
            </View>
            <Switch
              value={bgRelayEnabled}
              onValueChange={handleToggleBgRelay}
              trackColor={{ false: colors.surfaceAlt, true: colors.amberDark }}
              thumbColor={colors.white}
            />
          </View>
        </View>

        {/* Security & Cryptographic Protocol */}
        <View style={styles.card}>
          <View style={styles.rowWithIcon}>
            <IconKey size={18} color={colors.amber} />
            <Text style={styles.sectionHeader}>SECURITY & PRIVACY PROTOCOL</Text>
          </View>

          <Text style={styles.cardDesc}>
            End-to-End Encryption powered by Signal-style X3DH key exchange and Double Ratchet forward secrecy.
          </Text>

          <View style={styles.diagItem}>
            <Text style={styles.diagLabel}>E2E CIPHER</Text>
            <Badge variant="success">AES-256-GCM + X3DH</Badge>
          </View>

          <View style={styles.diagItem}>
            <Text style={styles.diagLabel}>DEVICE NODE ID</Text>
            <Text style={styles.diagValueMono}>{myId ? myId.substring(0, 18) + '…' : 'Active'}</Text>
          </View>
        </View>

        {/* Emergency Privacy */}
        <View style={styles.card}>
          <View style={styles.rowWithIcon}>
            <IconSatellite size={18} color={colors.danger} />
            <Text style={styles.sectionHeader}>EMERGENCY PRIVACY</Text>
          </View>

          <View style={styles.settingRow}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={styles.settingTitle}>Approximate GPS Coordinates</Text>
              <Text style={styles.subtext}>
                Fuzz distress location by ~100m for anti-triangulation safety
              </Text>
            </View>
            <Switch
              value={approxLocation}
              onValueChange={handleToggleApprox}
              trackColor={{ false: colors.surfaceAlt, true: colors.amberDark }}
              thumbColor={colors.white}
            />
          </View>
        </View>

        {/* Radio Diagnostics */}
        <View style={styles.card}>
          <View style={styles.rowWithIcon}>
            <IconRadioTower size={18} color={colors.signal} />
            <Text style={styles.sectionHeader}>RADIO DIAGNOSTICS</Text>
          </View>

          <View style={styles.diagItem}>
            <Text style={styles.diagLabel}>RADIO INTERFACE</Text>
            <Badge variant={connectedCount > 0 ? 'success' : 'outline'}>
              {connectedCount > 0 ? `${connectedCount} Connected Links` : 'Listening on BLE & Wi-Fi'}
            </Badge>
          </View>
          <View style={styles.diagItem}>
            <Text style={styles.diagLabel}>STORE-AND-FORWARD</Text>
            <Badge variant="success">Max 10 Hops Relay</Badge>
          </View>
        </View>

        {/* Trusted Peers Management */}
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionHeader}>TRUSTED PEERS ({pairedList.length})</Text>
            {pairedList.length > 0 && (
              <Pressable onPress={handleResetTrust} hitSlop={6}>
                <Text style={styles.dangerActionText}>Reset All</Text>
              </Pressable>
            )}
          </View>

          {pairedList.length === 0 ? (
            <Text style={styles.emptyText}>No trusted peers currently saved.</Text>
          ) : (
            <View style={{ gap: 8, marginTop: 8 }}>
              {pairedList.map((peer, idx) => (
                <View key={peer.id || idx} style={styles.peerItemRow}>
                  <Avatar fallback={peer.alias || 'P'} size="sm" tint={colors.amber} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.peerItemName}>{peer.alias || 'Contact'}</Text>
                    <Text style={styles.subtext}>Auto-reconnect trusted</Text>
                  </View>
                  <Pressable
                    onPress={() => handleUnpairSingle(peer)}
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

        {/* Blocked Devices Management */}
        <View style={styles.card}>
          <Text style={styles.sectionHeader}>BLOCKED DEVICES ({blockedPeersList?.length || 0})</Text>
          {(!blockedPeersList || blockedPeersList.length === 0) ? (
            <Text style={styles.emptyText}>No devices currently blocked.</Text>
          ) : (
            <View style={{ gap: 8, marginTop: 8 }}>
              {blockedPeersList.map((blockedId, idx) => (
                <View key={`blocked-${idx}`} style={styles.peerItemRow}>
                  <Avatar fallback="B" size="sm" tint={colors.danger} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.peerItemName} numberOfLines={1}>{blockedId}</Text>
                    <Text style={styles.subtext}>Blacklisted from messaging</Text>
                  </View>
                  <Button
                    size="sm"
                    variant="outline"
                    onPress={async () => {
                      if (unblockPeer) {
                        await unblockPeer(blockedId);
                        Alert.alert('Unblocked', `Device "${blockedId}" unblocked.`);
                      }
                    }}
                  >
                    Unblock
                  </Button>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Danger Zone */}
        <View style={[styles.card, { borderColor: 'rgba(239, 68, 68, 0.35)' }]}>
          <Text style={[styles.sectionHeader, { color: colors.danger }]}>DATA CONTROLS</Text>

          <Button
            variant="danger"
            size="default"
            onPress={handleResetTrust}
            style={{ marginTop: 8 }}
            icon={<IconTrash size={16} color={colors.danger} />}
          >
            Clear Trusted Friends Memory
          </Button>

          <Button
            variant="danger"
            size="default"
            onPress={handlePanicWipe}
            style={{ marginTop: 10 }}
            icon={<IconLock size={16} color={colors.danger} />}
          >
            Emergency Panic Wipe (All Data)
          </Button>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: 16,
    gap: 14,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.lg,
    padding: 16,
    gap: 10,
  },
  sectionHeader: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  cardDesc: {
    color: colors.textSecondary,
    fontSize: 12.5,
    lineHeight: 18,
  },
  rowWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  aliasInput: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.md,
    color: colors.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    fontWeight: '600',
  },
  subtext: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 3,
  },
  adminKeyBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    padding: 10,
    marginTop: 4,
  },
  adminKeyLabel: {
    color: colors.textMuted,
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  keyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    padding: 10,
    gap: 8,
  },
  monoKey: {
    color: colors.amber,
    fontSize: 11.5,
    fontFamily: 'monospace',
    flex: 1,
  },
  copyBtn: {
    padding: 4,
  },
  copiedText: {
    color: colors.signal,
    fontSize: 11,
    fontWeight: '600',
  },
  diagItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  diagLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  diagValueMono: {
    color: colors.textSecondary,
    fontSize: 11,
    fontFamily: 'monospace',
  },
  dangerActionText: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: '700',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
  },
  peerItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    padding: 10,
  },
  peerItemName: {
    color: colors.textPrimary,
    fontSize: 13.5,
    fontWeight: '600',
  },
  unpairBtn: {
    padding: 6,
  },
});
