import React, { useState, useEffect, useContext, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  Linking,
  Platform,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppContext } from '../AppContext';
import {
  triggerHelpRequest,
  cancelHelpRequest,
  getMyActiveHelpRequestId,
  listActiveRequests,
} from '../lib/HelpRequestManager';
import { getPairedContacts } from '../lib/ContactManager';
import { colors, radii } from '../theme';
import { TopBar } from '../components/layout/TopBar';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import {
  IconMedical,
  IconShield,
  IconBox,
  IconSOS,
  IconSatellite,
  IconLock,
  IconMapPin,
  IconCheck,
  IconMap,
} from '../icons/Icons';

const URGENCY = [
  { key: 'medical', label: 'Medical', Icon: IconMedical },
  { key: 'security', label: 'Security', Icon: IconShield },
  { key: 'supplies', label: 'Supplies', Icon: IconBox },
  { key: 'general', label: 'General', Icon: IconSOS },
];

const PRIVACY = [
  { key: 'both', label: 'Both', sub: 'Recommended', Icon: IconSatellite },
  { key: 'circle', label: 'Contacts', sub: 'Circle only', Icon: IconLock },
  { key: 'broadcast', label: 'Anonymous', sub: 'Mesh broadcast', Icon: IconSatellite },
];

const fmt = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const PulsingButton = ({ onPress, loading }) => {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });

  return (
    <Pressable onPress={onPress} disabled={loading} style={{ width: '100%' }}>
      <Animated.View
        style={[
          styles.sosBtn,
          { transform: [{ scale }], opacity: glowOpacity },
        ]}
      >
        <IconSOS size={22} color={colors.white} />
        <Text style={styles.sosLabel}>
          {loading ? 'TRANSMITTING BEACON…' : 'BROADCAST SOS'}
        </Text>
      </Animated.View>
    </Pressable>
  );
};

export default function HelpScreen({ navigation, onBack }) {
  const { myId, myAlias, peers } = useContext(AppContext);
  const insets = useSafeAreaInsets();
  const [activeReqId, setActiveReqId] = useState(null);
  const [requests, setRequests] = useState([]);
  const [urgency, setUrgency] = useState('general');
  const [tierOption, setTierOption] = useState('both');
  const [note, setNote] = useState('');
  const [isTriggering, setIsTriggering] = useState(false);

  useEffect(() => {
    loadState();
    const interval = setInterval(loadState, 2500);
    return () => clearInterval(interval);
  }, []);

  async function loadState() {
    const myActive = await getMyActiveHelpRequestId();
    setActiveReqId(myActive);
    const activeList = await listActiveRequests();
    setRequests(activeList || []);
  }

  async function executeSendSOS(tiersToSend) {
    setIsTriggering(true);
    try {
      await triggerHelpRequest({
        tiers: tiersToSend,
        urgencyType: urgency,
        note: note.trim(),
        myId,
        myAlias,
        peers,
      });
      setNote('');
      await loadState();
      Alert.alert(
        '🚨 SOS Beacon Active',
        'Distress signal broadcast over offline radio frequencies.\n\nConnected peers and trusted contacts have been alerted.'
      );
    } catch (e) {
      Alert.alert('SOS Error', e.message || 'Failed to broadcast distress signal');
    } finally {
      setIsTriggering(false);
    }
  }

  function handleTriggerSOS() {
    const contacts = getPairedContacts ? getPairedContacts() : [];
    const hasContacts = contacts.length > 0;

    let tiersToSend = ['broadcast'];
    if (tierOption === 'circle') {
      if (!hasContacts) {
        Alert.alert(
          'No Trusted Contacts',
          'You have no paired contacts in your Trust Circle. Would you like to broadcast anonymously to the general mesh instead?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Broadcast to Mesh', onPress: () => executeSendSOS(['broadcast']) },
          ]
        );
        return;
      }
      tiersToSend = ['circle'];
    } else if (tierOption === 'both') {
      tiersToSend = hasContacts ? ['circle', 'broadcast'] : ['broadcast'];
    }

    Alert.alert(
      '🚨 CONFIRM EMERGENCY SOS',
      `Transmit distress beacon?\n\nUrgency: ${urgency.toUpperCase()}\nScope: ${tiersToSend.join(' + ').toUpperCase()}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'BROADCAST SOS',
          style: 'destructive',
          onPress: () => executeSendSOS(tiersToSend),
        },
      ]
    );
  }

  async function handleResolve(reqId) {
    Alert.alert(
      'Resolve Emergency',
      'Mark your emergency distress as resolved and notify the mesh network?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Resolved',
          onPress: async () => {
            try {
              await cancelHelpRequest(reqId, peers);
              await loadState();
              Alert.alert('Resolved', 'Emergency cancellation broadcasted to mesh.');
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          },
        },
      ]
    );
  }

  return (
    <View style={styles.container}>
      <TopBar
        title="Emergency SOS"
        subtitle="Off-Grid Distress Beacon"
        onBack={onBack || (() => navigation?.goBack ? navigation.goBack() : null)}
        showEmergency={false}
      />

      <FlatList
        data={requests}
        keyExtractor={(item) => item.id || `req-${Math.random()}`}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) + 80 }]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            {/* Active Beacon Banner */}
            {activeReqId && (
              <View style={styles.activeBeaconCard}>
                <View style={styles.beaconPing}>
                  <View style={styles.beaconDot} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.activeBeaconTitle}>YOUR DISTRESS BEACON IS BROADCASTING</Text>
                  <Text style={styles.activeBeaconSub}>
                    Propagating to all mesh nodes within radio range.
                  </Text>
                </View>
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() => handleResolve(activeReqId)}
                  style={{ borderColor: colors.danger, backgroundColor: 'rgba(239, 68, 68, 0.15)' }}
                >
                  Resolve
                </Button>
              </View>
            )}

            {/* Quick Map Link Card */}
            <Pressable
              style={styles.mapBannerCard}
              onPress={() => navigation?.navigate && navigation.navigate('Map')}
            >
              <View style={styles.mapBannerIconWrap}>
                <IconMap size={18} color={colors.amber} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.mapBannerTitle}>Resource Map & Safe Havens</Text>
                <Text style={styles.mapBannerSub}>
                  Find nearby medical stations, evacuation shelters, and water points.
                </Text>
              </View>
              <Text style={styles.mapBannerAction}>View Map →</Text>
            </Pressable>

            {/* Urgency Type */}
            <Text style={styles.sectionHeading}>URGENCY TYPE</Text>
            <View style={styles.urgencyGrid}>
              {URGENCY.map((item) => {
                const active = urgency === item.key;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setUrgency(item.key)}
                    style={[styles.urgencyOption, active && styles.urgencyOptionActive]}
                  >
                    <item.Icon
                      size={22}
                      color={active ? colors.amber : colors.textSecondary}
                    />
                    <Text style={[styles.urgencyLabel, active && styles.urgencyLabelActive]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Privacy Tier */}
            <Text style={styles.sectionHeading}>TRANSMISSION SCOPE</Text>
            <View style={styles.privacyGrid}>
              {PRIVACY.map((item) => {
                const active = tierOption === item.key;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setTierOption(item.key)}
                    style={[styles.privacyOption, active && styles.privacyOptionActive]}
                  >
                    <item.Icon
                      size={18}
                      color={active ? colors.amber : colors.textSecondary}
                    />
                    <Text style={[styles.privacyLabel, active && styles.privacyLabelActive]}>
                      {item.label}
                    </Text>
                    <Text style={styles.privacySub}>{item.sub}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Brief Note Input */}
            <Text style={styles.sectionHeading}>EMERGENCY DETAILS (OPTIONAL)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="e.g. 2 injured, structural damage, need clean water..."
              placeholderTextColor={colors.textMuted}
              style={styles.noteInput}
              maxLength={200}
              multiline
            />

            {/* Trigger SOS Button */}
            <View style={{ marginTop: 20 }}>
              <PulsingButton onPress={handleTriggerSOS} loading={isTriggering} />
            </View>

            {/* Active Requests Feed Header */}
            <View style={styles.signalsHeaderRow}>
              <Text style={styles.sectionHeading}>ACTIVE MESH SIGNALS ({requests.length})</Text>
            </View>
          </>
        }
        renderItem={({ item }) => {
          const isMine = item.senderId === myId;
          return (
            <View style={styles.signalCard}>
              <View style={styles.cardHeader}>
                <View style={styles.senderWrap}>
                  <View style={styles.sosDotWrap}>
                    <IconSOS size={16} color={colors.danger} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.senderTitle}>
                      {item.senderAlias || (isMine ? 'You (Local Beacon)' : 'Mesh Peer')}
                    </Text>
                    <Text style={styles.timestampText}>{fmt(item.createdAt || item.ts)}</Text>
                  </View>
                </View>

                <Badge variant="destructive">
                  {item.urgencyType?.toUpperCase() || 'GENERAL'}
                </Badge>
              </View>

              {item.note ? (
                <Text style={styles.signalNote}>"{item.note}"</Text>
              ) : null}

              {item.location ? (
                <View style={styles.locationRow}>
                  <IconMapPin size={14} color={colors.amber} />
                  <Text style={styles.coordText}>
                    {(item.location.latitude ?? item.location.lat)?.toFixed(3)}, {(item.location.longitude ?? item.location.lng)?.toFixed(3)}
                  </Text>
                  <Pressable
                    onPress={() => {
                      if (navigation?.navigate) {
                        navigation.navigate('Map');
                      }
                    }}
                    style={{ marginLeft: 'auto', paddingHorizontal: 6, paddingVertical: 4 }}
                  >
                    <Text style={styles.mapLinkText}>Local Map 📍</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      const lat = item.location.latitude ?? item.location.lat;
                      const lng = item.location.longitude ?? item.location.lng;
                      if (lat != null && lng != null) {
                        Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`).catch(() => {});
                      }
                    }}
                    style={{ marginLeft: 6, paddingHorizontal: 6, paddingVertical: 4 }}
                  >
                    <Text style={[styles.mapLinkText, { color: colors.amber }]}>Google Maps 🗺️</Text>
                  </Pressable>
                </View>
              ) : null}

              {isMine && (
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() => handleResolve(item.id)}
                  style={{ marginTop: 10, borderColor: colors.hairline }}
                >
                  Mark Distress Resolved ✓
                </Button>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptySignalsWrap}>
            <Text style={styles.emptySignalsText}>No active distress signals in radio mesh range.</Text>
          </View>
        }
      />
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
    gap: 12,
  },
  activeBeaconCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.45)',
    borderRadius: radii.lg,
    padding: 14,
    gap: 10,
    marginBottom: 6,
  },
  beaconPing: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  beaconDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.danger,
  },
  activeBeaconTitle: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  activeBeaconSub: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  mapBannerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.lg,
    padding: 14,
    gap: 12,
  },
  mapBannerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapBannerTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  mapBannerSub: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  mapBannerAction: {
    color: colors.amber,
    fontSize: 12,
    fontWeight: '700',
  },
  sectionHeading: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 6,
  },
  urgencyGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  urgencyOption: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.md,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  urgencyOptionActive: {
    borderColor: colors.amber,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
  },
  urgencyLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  urgencyLabelActive: {
    color: colors.amber,
    fontWeight: '700',
  },
  privacyGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  privacyOption: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.md,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  privacyOptionActive: {
    borderColor: colors.amber,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
  },
  privacyLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  privacyLabelActive: {
    color: colors.amber,
    fontWeight: '700',
  },
  privacySub: {
    color: colors.textMuted,
    fontSize: 10,
  },
  noteInput: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    color: colors.textPrimary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 65,
    textAlignVertical: 'top',
  },
  sosBtn: {
    backgroundColor: colors.danger,
    borderRadius: radii.lg,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: colors.danger,
    shadowOpacity: 0.6,
    shadowRadius: 14,
    elevation: 8,
  },
  sosLabel: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  signalsHeaderRow: {
    marginTop: 14,
  },
  signalCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.lg,
    padding: 14,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  senderWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  sosDotWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  senderTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  timestampText: {
    color: colors.textMuted,
    fontSize: 10.5,
    marginTop: 1,
  },
  signalNote: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    padding: 8,
    paddingHorizontal: 10,
    gap: 6,
  },
  coordText: {
    color: colors.textSecondary,
    fontSize: 11.5,
    fontFamily: 'monospace',
  },
  mapLinkText: {
    color: colors.amber,
    fontSize: 11,
    fontWeight: '700',
  },
  emptySignalsWrap: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptySignalsText: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
