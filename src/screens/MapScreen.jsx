import React, { useState, useEffect, useRef, useContext } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  Linking,
  Animated,
  Dimensions,
} from 'react-native';
import Svg, {
  Path,
  Circle,
  Line,
  Rect,
  G,
  Text as SvgText,
} from 'react-native-svg';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppContext } from '../AppContext';
import { listActiveRequests } from '../lib/HelpRequestManager';
import { getIsAdmin } from '../lib/AdminKeyRegistry';
import { broadcastMessage } from '../lib/p2p';
import { colors, radii } from '../theme';
import { TopBar } from '../components/layout/TopBar';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import {
  IconCrosshair,
  IconPlus,
  IconMapPin,
  IconMedical,
  IconShield,
  IconWater,
  IconTent,
  IconSOS,
  IconCopy,
  IconCheck,
} from '../icons/Icons';

const STORE_RESOURCE_PINS = '@dp_resource_pins';

const DEFAULT_PINS = [
  {
    id: 'res-safe-1',
    title: 'Safe Zone Alpha (Civic Hall)',
    type: 'SAFE_ZONE',
    latOffset: 0.0035,
    lngOffset: -0.0028,
    status: 'fresh',
    verified: true,
    note: 'Reinforced concrete structure with emergency generator, satellite radio, and food rations.',
    timestamp: '25m ago',
  },
  {
    id: 'res-med-1',
    title: 'Emergency Medical Station 1',
    type: 'MEDICAL',
    latOffset: -0.0042,
    lngOffset: 0.0036,
    status: 'fresh',
    verified: true,
    note: 'Triage tent with 3 certified EMTs, oxygen cylinders, trauma kits, and sterile water.',
    timestamp: '40m ago',
  },
  {
    id: 'res-water-1',
    title: 'Clean Water Distribution Point',
    type: 'WATER',
    latOffset: 0.0051,
    lngOffset: 0.0045,
    status: 'active',
    verified: true,
    note: '5,000L purified water reservoir with manual hand-pumps available 24/7.',
    timestamp: '2h ago',
  },
  {
    id: 'res-shelter-1',
    title: 'Highland Evacuation Shelter',
    type: 'SHELTER',
    latOffset: -0.0022,
    lngOffset: -0.0052,
    status: 'active',
    verified: false,
    note: 'Dry indoor gymnasium on elevated ground. Blankets and bedding available.',
    timestamp: '4h ago',
  },
];

function calculateDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 'Unknown distance';
  const R = 6371e3; // meters
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;
  if (d < 1000) return `${Math.round(d)} m away`;
  return `${(d / 1000).toFixed(1)} km away`;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return '';
  const toRad = (x) => (x * Math.PI) / 180;
  const toDeg = (x) => (x * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  let brng = (toDeg(Math.atan2(y, x)) + 360) % 360;
  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(brng / 45) % 8;
  return `Heading ${Math.round(brng)}° ${cardinals[idx]}`;
}

export default function MapScreen({ navigation, onBack }) {
  const { peers, sendBulletin, isAdmin: adminFromCtx } = useContext(AppContext);
  const [userLocation, setUserLocation] = useState(null);
  const userLocRef = useRef(null);
  const [filter, setFilter] = useState('ALL');
  const [pins, setPins] = useState([]);
  const [selectedPin, setSelectedPin] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [copiedCoords, setCopiedCoords] = useState(false);
  const isAdmin = adminFromCtx || getIsAdmin();

  // New pin form
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState('SAFE_ZONE');
  const [newNote, setNewNote] = useState('');
  const [locationMode, setLocationMode] = useState('gps'); // 'gps' | 'custom'
  const [customLat, setCustomLat] = useState('');
  const [customLng, setCustomLng] = useState('');

  // Pulse animation for GPS marker
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    ).start();
  }, [pulseAnim]);

  // Load GPS and Pins
  useEffect(() => {
    fetchLocation();
    const interval = setInterval(() => {
      loadPins(userLocRef.current);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  async function fetchLocation() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const coords = {
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          accuracy: loc.coords.accuracy,
        };
        userLocRef.current = coords;
        setUserLocation(coords);
        loadPins(coords);
      } else {
        const fallback = { lat: 12.9716, lng: 77.5946, accuracy: 50 };
        userLocRef.current = fallback;
        setUserLocation(fallback);
        loadPins(fallback);
      }
    } catch {
      const fallback = { lat: 12.9716, lng: 77.5946, accuracy: 50 };
      userLocRef.current = fallback;
      setUserLocation(fallback);
      loadPins(fallback);
    }
  }

  async function loadPins(loc = null) {
    try {
      const activeLoc = loc || userLocRef.current || userLocation;
      let storedPins = [];
      const raw = await AsyncStorage.getItem(STORE_RESOURCE_PINS);
      if (raw) storedPins = JSON.parse(raw);

      let sosPins = [];
      try {
        const activeSOS = await listActiveRequests();
        sosPins = activeSOS
          .filter((req) => req.location && req.location.lat && req.location.lng)
          .map((req) => ({
            id: `sos-${req.id}`,
            title: `Distress SOS: ${req.alias || 'Peer'}`,
            type: 'SOS',
            lat: req.location.lat,
            lng: req.location.lng,
            status: 'fresh',
            verified: true,
            note: req.note ? `Note: "${req.note}"` : 'Emergency Distress Beacon Broadcast',
            timestamp: 'LIVE NOW',
            urgency: req.urgencyType,
          }));
      } catch {}

      const baseLat = activeLoc?.lat || 12.9716;
      const baseLng = activeLoc?.lng || 77.5946;

      const dynamicDefaults = DEFAULT_PINS.map((p) => ({
        ...p,
        lat: baseLat + p.latOffset,
        lng: baseLng + p.lngOffset,
      }));

      setPins([...sosPins, ...storedPins, ...dynamicDefaults]);
    } catch (e) {
      console.warn('[MapScreen] Failed to load pins:', e);
    }
  }

  async function handleAddPin() {
    if (!isAdmin) {
      Alert.alert('Restricted', 'Only verified Mesh Administrators can publish official resources.');
      return;
    }
    if (!newTitle.trim()) {
      Alert.alert('Required', 'Please enter a name for this resource or safe point.');
      return;
    }

    let pinLat = userLocation?.lat || 12.9716;
    let pinLng = userLocation?.lng || 77.5946;

    if (locationMode === 'custom') {
      const parsedLat = parseFloat(customLat);
      const parsedLng = parseFloat(customLng);
      if (isNaN(parsedLat) || isNaN(parsedLng)) {
        Alert.alert('Invalid Coordinates', 'Please enter valid numerical latitude and longitude.');
        return;
      }
      pinLat = parsedLat;
      pinLng = parsedLng;
    }

    const newPin = {
      id: `res-${Date.now()}`,
      title: newTitle.trim(),
      type: newType,
      lat: pinLat,
      lng: pinLng,
      status: 'fresh',
      verified: true,
      note: newNote.trim() || 'Official mesh resource point.',
      timestamp: 'Just now',
    };

    try {
      const existingRaw = await AsyncStorage.getItem(STORE_RESOURCE_PINS);
      const existing = existingRaw ? JSON.parse(existingRaw) : [];
      const updated = [newPin, ...existing];
      await AsyncStorage.setItem(STORE_RESOURCE_PINS, JSON.stringify(updated));

      // Broadcast to mesh over radio
      await broadcastMessage({
        type: 'RESOURCE_SYNC',
        action: 'ADD',
        resource: newPin,
      });

      if (sendBulletin) {
        sendBulletin(
          `📍 OFFICIAL SAFE POINT: [${newType}] ${newPin.title} at ${pinLat.toFixed(4)}, ${pinLng.toFixed(4)}`,
          'RESOURCE'
        ).catch(() => {});
      }

      setPins((prev) => [newPin, ...prev]);
      setShowAddModal(false);
      setNewTitle('');
      setNewNote('');
      setCustomLat('');
      setCustomLng('');
      setSelectedPin(newPin);
      Alert.alert('Resource Published', `"${newPin.title}" has been saved and broadcasted to all nearby mesh devices.`);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  async function handleDeletePin(pinToDelete) {
    if (!isAdmin) {
      Alert.alert('Restricted', 'Only verified Mesh Administrators can remove official resources.');
      return;
    }

    Alert.alert('Delete Resource', `Remove "${pinToDelete.title}" from the mesh resource map?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const existingRaw = await AsyncStorage.getItem(STORE_RESOURCE_PINS);
            const existing = existingRaw ? JSON.parse(existingRaw) : [];
            const updated = existing.filter(p => p.id !== pinToDelete.id);
            await AsyncStorage.setItem(STORE_RESOURCE_PINS, JSON.stringify(updated));

            await broadcastMessage({
              type: 'RESOURCE_SYNC',
              action: 'DELETE',
              resourceId: pinToDelete.id,
            });

            setSelectedPin(null);
            loadPins();
            Alert.alert('Deleted', 'Resource has been removed.');
          } catch (e) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  }

  const filteredPins = pins.filter((p) => {
    if (filter === 'ALL') return true;
    if (filter === 'SAFE_ZONE') return p.type === 'SAFE_ZONE';
    if (filter === 'MEDICAL') return p.type === 'MEDICAL';
    if (filter === 'WATER') return p.type === 'WATER';
    if (filter === 'SHELTER') return p.type === 'SHELTER';
    if (filter === 'SOS') return p.type === 'SOS';
    return true;
  });

  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
  const mapHeight = screenHeight - 170;

  // Map coordinates to canvas projection centered around user location
  const centerLat = userLocation?.lat || userLocRef.current?.lat || 12.9716;
  const centerLng = userLocation?.lng || userLocRef.current?.lng || 77.5946;
  const scale = 36000; // zoom factor

  const project = (lat, lng) => {
    const x = screenWidth / 2 + (lng - centerLng) * scale;
    const y = mapHeight / 2 - (lat - centerLat) * scale;
    return { x: Math.max(30, Math.min(screenWidth - 30, x)), y: Math.max(30, Math.min(mapHeight - 30, y)) };
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'MEDICAL': return colors.signal; // Emerald
      case 'SAFE_ZONE': return colors.amber;  // Amber
      case 'WATER': return colors.blue;      // Blue
      case 'SHELTER': return '#a855f7';      // Purple
      case 'SOS': return colors.danger;      // Red
      default: return colors.amber;
    }
  };

  const pulseScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 2.4],
  });

  const pulseOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.7, 0],
  });

  return (
    <View style={styles.container}>
      <TopBar
        title="Resource Map"
        subtitle="Offline Safe Zones & Medical Aid"
        onBack={onBack || (() => navigation?.goBack ? navigation.goBack() : null)}
        showMap={false}
        onEmergencyPress={() => navigation?.navigate && navigation.navigate('Help')}
      />

      {/* Filter Bar */}
      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {[
            { key: 'ALL', label: 'ALL' },
            { key: 'SAFE_ZONE', label: 'SAFE ZONE' },
            { key: 'MEDICAL', label: 'MEDICAL' },
            { key: 'WATER', label: 'WATER' },
            { key: 'SHELTER', label: 'SHELTER' },
            { key: 'SOS', label: '🚨 SOS' },
          ].map((item) => {
            const active = filter === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => setFilter(item.key)}
                style={[styles.filterChip, active && styles.filterChipActive]}
              >
                <Text style={[styles.filterText, active && styles.filterTextActive]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Map Canvas */}
      <View style={[styles.mapCanvas, { height: mapHeight }]}>
        <Svg width={screenWidth} height={mapHeight} style={StyleSheet.absoluteFill}>
          {/* Tactical Grid Background */}
          {Array.from({ length: Math.ceil(screenWidth / 40) }).map((_, i) => (
            <Line
              key={`vg-${i}`}
              x1={i * 40}
              y1={0}
              x2={i * 40}
              y2={mapHeight}
              stroke="rgba(255, 255, 255, 0.04)"
              strokeWidth={1}
            />
          ))}
          {Array.from({ length: Math.ceil(mapHeight / 40) }).map((_, i) => (
            <Line
              key={`hg-${i}`}
              x1={0}
              y1={i * 40}
              x2={screenWidth}
              y2={i * 40}
              stroke="rgba(255, 255, 255, 0.04)"
              strokeWidth={1}
            />
          ))}

          {/* Simulated Evacuation Routes & Corridors */}
          <Path
            d={`M0,${mapHeight * 0.25} Q${screenWidth * 0.4},${mapHeight * 0.3} ${screenWidth * 0.5},${mapHeight * 0.5} T${screenWidth},${mapHeight * 0.7}`}
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth={4}
            fill="none"
          />
          <Path
            d={`M${screenWidth * 0.2},0 Q${screenWidth * 0.3},${mapHeight * 0.4} ${screenWidth * 0.5},${mapHeight * 0.5} T${screenWidth * 0.8},${mapHeight}`}
            stroke="rgba(255, 255, 255, 0.06)"
            strokeWidth={6}
            fill="none"
          />
          <Path
            d={`M0,${mapHeight * 0.8} L${screenWidth},${mapHeight * 0.35}`}
            stroke="rgba(245, 158, 11, 0.08)"
            strokeWidth={2}
            strokeDasharray="4,4"
            fill="none"
          />

          {/* Tactical Compass Overlay in Top Right */}
          <G x={screenWidth - 45} y={45}>
            <Circle r={20} fill="rgba(24, 24, 27, 0.7)" stroke={colors.hairline} strokeWidth={1} />
            <Line x1={0} y1={-14} x2={0} y2={14} stroke={colors.textSecondary} strokeWidth={1.5} />
            <Line x1={-14} y1={0} x2={14} y2={0} stroke={colors.textSecondary} strokeWidth={1.5} />
            <SvgText x={0} y={-8} fill={colors.amber} fontSize={9} fontWeight="bold" textAnchor="middle">N</SvgText>
          </G>
        </Svg>

        {/* User GPS Center Marker */}
        <View style={[styles.userMarkerWrap, { top: mapHeight / 2 - 16, left: screenWidth / 2 - 16 }]}>
          <Animated.View
            style={[
              styles.userRadarWave,
              { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
            ]}
          />
          <View style={styles.userDotCenter} />
        </View>

        {/* Resource Pins on Map */}
        {filteredPins.map((pin) => {
          const pt = project(pin.lat, pin.lng);
          const pinColor = getTypeColor(pin.type);
          const isSelected = selectedPin?.id === pin.id;
          const isSOS = pin.type === 'SOS';

          return (
            <Pressable
              key={pin.id}
              onPress={() => setSelectedPin(pin)}
              style={[
                styles.pinContainer,
                { top: pt.y - 20, left: pt.x - 20 },
                isSelected && styles.pinContainerSelected,
              ]}
              hitSlop={12}
            >
              <View
                style={[
                  styles.pinIconBubble,
                  { backgroundColor: isSOS ? 'rgba(239, 68, 68, 0.25)' : 'rgba(24, 24, 27, 0.95)', borderColor: pinColor },
                  isSelected && { borderColor: colors.white, transform: [{ scale: 1.15 }] },
                ]}
              >
                {pin.type === 'MEDICAL' && <IconMedical size={15} color={pinColor} />}
                {pin.type === 'SAFE_ZONE' && <IconShield size={15} color={pinColor} />}
                {pin.type === 'WATER' && <IconWater size={15} color={pinColor} />}
                {pin.type === 'SHELTER' && <IconTent size={15} color={pinColor} />}
                {pin.type === 'SOS' && <IconSOS size={16} color={colors.danger} />}
              </View>
              <View style={[styles.pinLabelBadge, { backgroundColor: isSOS ? colors.danger : colors.surfaceAlt }]}>
                <Text style={styles.pinLabelText} numberOfLines={1}>
                  {pin.title.split(' ')[0]}
                </Text>
              </View>
            </Pressable>
          );
        })}

        {/* Map Legend (Top Left) */}
        <View style={styles.legendBox}>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: colors.signal }]} />
            <Text style={styles.legendText}>Fresh (&lt; 1h)</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: colors.amber, opacity: 0.8 }]} />
            <Text style={styles.legendText}>Active (&lt; 6h)</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: colors.danger }]} />
            <Text style={styles.legendText}>Active SOS</Text>
          </View>
        </View>

        {/* Floating Map Controls (Right Side) */}
        <View style={styles.mapControls}>
          <Pressable
            onPress={fetchLocation}
            style={({ pressed }) => [styles.ctrlBtn, pressed && styles.btnPressed]}
          >
            <IconCrosshair size={20} color={colors.textPrimary} />
          </Pressable>
          {isAdmin && (
            <Pressable
              onPress={() => setShowAddModal(true)}
              style={({ pressed }) => [styles.addPinBtn, pressed && styles.btnPressed]}
            >
              <IconPlus size={22} color={colors.white} />
            </Pressable>
          )}
        </View>

        {/* Selected Pin Details Bottom Sheet Card */}
        {selectedPin && (
          <View style={styles.detailCard}>
            <View style={styles.detailHeader}>
              <View style={styles.detailTitleWrap}>
                <View style={styles.badgeRow}>
                  <Badge
                    variant={selectedPin.type === 'SOS' ? 'destructive' : 'default'}
                    style={{ backgroundColor: getTypeColor(selectedPin.type) + '22', borderColor: getTypeColor(selectedPin.type) }}
                  >
                    {selectedPin.type.replace('_', ' ')}
                  </Badge>
                  {selectedPin.verified && (
                    <Badge variant="success">✓ Verified</Badge>
                  )}
                  <Text style={styles.timestampText}>{selectedPin.timestamp}</Text>
                </View>
                <Text style={styles.detailTitle}>{selectedPin.title}</Text>
              </View>
              <Pressable
                onPress={() => setSelectedPin(null)}
                style={styles.closeCardBtn}
                hitSlop={8}
              >
                <Text style={{ color: colors.textSecondary, fontSize: 16 }}>✕</Text>
              </Pressable>
            </View>

            <Text style={styles.detailNote}>{selectedPin.note}</Text>

            <View style={styles.metaRow}>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>DISTANCE</Text>
                <Text style={styles.metaValue}>
                  {calculateDistance(userLocation?.lat, userLocation?.lng, selectedPin.lat, selectedPin.lng)}
                </Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>BEARING</Text>
                <Text style={styles.metaValue}>
                  {calculateBearing(userLocation?.lat, userLocation?.lng, selectedPin.lat, selectedPin.lng) || 'Adjacent'}
                </Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>GPS COORDS</Text>
                <Text style={styles.metaValueMono}>
                  {selectedPin.lat?.toFixed(4)}, {selectedPin.lng?.toFixed(4)}
                </Text>
              </View>
            </View>

            <View style={styles.cardActions}>
              <Button
                variant="outline"
                size="sm"
                style={{ flex: 1 }}
                onPress={() => {
                  setCopiedCoords(true);
                  setTimeout(() => setCopiedCoords(false), 2000);
                  Alert.alert('Coordinates', `${selectedPin.lat.toFixed(6)}, ${selectedPin.lng.toFixed(6)} copied.`);
                }}
                icon={copiedCoords ? <IconCheck size={14} color={colors.signal} /> : <IconCopy size={14} color={colors.textSecondary} />}
              >
                {copiedCoords ? 'Copied' : 'Copy GPS'}
              </Button>
              <Button
                variant="default"
                size="sm"
                style={{ flex: 1.2 }}
                onPress={() => {
                  const lat = selectedPin.lat != null ? selectedPin.lat : (userLocation ? userLocation.lat + (selectedPin.latOffset || 0) : null);
                  const lng = selectedPin.lng != null ? selectedPin.lng : (userLocation ? userLocation.lng + (selectedPin.lngOffset || 0) : null);
                  if (lat != null && lng != null) {
                    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`).catch(() => {
                      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`).catch(() => {});
                    });
                  } else {
                    Alert.alert('Location unavailable', 'Coordinates could not be resolved for this pin.');
                  }
                }}
              >
                🧭 Navigate (Maps)
              </Button>
              {isAdmin && selectedPin.type !== 'SOS' && (
                <Button
                  variant="danger"
                  size="sm"
                  style={{ flex: 0.9 }}
                  onPress={() => handleDeletePin(selectedPin)}
                >
                  Delete
                </Button>
              )}
            </View>
          </View>
        )}
      </View>

      {/* Add Resource Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Publish Emergency Resource"
      >
        <ScrollView style={{ maxHeight: 420 }}>
          <Text style={styles.modalSub}>
            Pin a verified safe zone, water station, or medical triage point to the offline radio map.
          </Text>

          <Text style={styles.inputLabel}>CATEGORY</Text>
          <View style={styles.typeSelector}>
            {[
              { key: 'SAFE_ZONE', label: 'Safe Zone' },
              { key: 'MEDICAL', label: 'Medical' },
              { key: 'WATER', label: 'Water' },
              { key: 'SHELTER', label: 'Shelter' },
            ].map((t) => (
              <Pressable
                key={t.key}
                onPress={() => setNewType(t.key)}
                style={[styles.typeOption, newType === t.key && styles.typeOptionActive]}
              >
                <Text style={[styles.typeOptionText, newType === t.key && styles.typeOptionTextActive]}>
                  {t.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.inputLabel}>RESOURCE NAME</Text>
          <TextInput
            style={styles.textInput}
            placeholder="e.g. West Community Water Tank"
            placeholderTextColor={colors.textMuted}
            value={newTitle}
            onChangeText={setNewTitle}
          />

          <Text style={styles.inputLabel}>NOTES & CAPACITY</Text>
          <TextInput
            style={[styles.textInput, { height: 80, textAlignVertical: 'top' }]}
            placeholder="e.g. 5,000L clean drinking water, manual pump, operational 24/7."
            placeholderTextColor={colors.textMuted}
            value={newNote}
            onChangeText={setNewNote}
            multiline
          />

          <Text style={styles.inputLabel}>PIN LOCATION</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            <Pressable
              onPress={() => setLocationMode('gps')}
              style={[
                styles.filterChip,
                locationMode === 'gps' && styles.filterChipActive,
                { flex: 1, alignItems: 'center', paddingVertical: 8 },
              ]}
            >
              <Text
                style={[
                  styles.filterText,
                  locationMode === 'gps' && styles.filterTextActive,
                ]}
              >
                📍 Device GPS
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setLocationMode('custom')}
              style={[
                styles.filterChip,
                locationMode === 'custom' && styles.filterChipActive,
                { flex: 1, alignItems: 'center', paddingVertical: 8 },
              ]}
            >
              <Text
                style={[
                  styles.filterText,
                  locationMode === 'custom' && styles.filterTextActive,
                ]}
              >
                🌐 Custom Coords
              </Text>
            </Pressable>
          </View>

          {locationMode === 'gps' ? (
            <View style={styles.gpsIndicatorBox}>
              <IconMapPin size={16} color={colors.amber} />
              <Text style={styles.gpsIndicatorText}>
                Pin will lock to current device GPS coordinates ({userLocation?.lat.toFixed(4)}, {userLocation?.lng.toFixed(4)})
              </Text>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>LATITUDE</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="e.g. 12.9716"
                  placeholderTextColor={colors.textMuted}
                  value={customLat}
                  onChangeText={setCustomLat}
                  keyboardType="numeric"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>LONGITUDE</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="e.g. 77.5946"
                  placeholderTextColor={colors.textMuted}
                  value={customLng}
                  onChangeText={setCustomLng}
                  keyboardType="numeric"
                />
              </View>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
            <Button
              variant="outline"
              style={{ flex: 1 }}
              onPress={() => setShowAddModal(false)}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              style={{ flex: 1 }}
              onPress={handleAddPin}
            >
              Publish to Mesh
            </Button>
          </View>
        </ScrollView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  filterBar: {
    backgroundColor: colors.bgElevated,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    paddingVertical: 8,
  },
  filterScroll: {
    paddingHorizontal: 14,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  filterChipActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  filterText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  filterTextActive: {
    color: colors.bg,
  },
  mapCanvas: {
    flex: 1,
    backgroundColor: '#0c0c0e',
    position: 'relative',
    overflow: 'hidden',
  },
  userMarkerWrap: {
    position: 'absolute',
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userRadarWave: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(59, 130, 246, 0.4)',
  },
  userDotCenter: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.blue,
    borderWidth: 2.5,
    borderColor: colors.white,
    shadowColor: colors.blue,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 6,
  },
  pinContainer: {
    position: 'absolute',
    width: 40,
    height: 52,
    alignItems: 'center',
    justifyContent: 'flex-start',
    zIndex: 10,
  },
  pinContainerSelected: {
    zIndex: 20,
  },
  pinIconBubble: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 6,
    elevation: 4,
  },
  pinLabelBadge: {
    marginTop: 2,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    maxWidth: 70,
  },
  pinLabelText: {
    color: colors.textPrimary,
    fontSize: 9,
    fontWeight: '700',
  },
  legendBox: {
    position: 'absolute',
    top: 14,
    left: 14,
    backgroundColor: 'rgba(9, 9, 11, 0.88)',
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.md,
    padding: 10,
    gap: 6,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  legendText: {
    color: colors.textSecondary,
    fontSize: 10.5,
    fontWeight: '500',
  },
  mapControls: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    gap: 12,
    zIndex: 25,
  },
  ctrlBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(24, 24, 27, 0.94)',
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  addPinBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.amberDark,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.amber,
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  btnPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.96 }],
  },
  detailCard: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.lg,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.7,
    shadowRadius: 16,
    elevation: 10,
    zIndex: 30,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  detailTitleWrap: {
    flex: 1,
    paddingRight: 10,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  timestampText: {
    color: colors.textMuted,
    fontSize: 10,
    marginLeft: 2,
  },
  detailTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  closeCardBtn: {
    padding: 4,
  },
  detailNote: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    padding: 10,
    marginBottom: 12,
    justifyContent: 'space-between',
  },
  metaItem: {
    alignItems: 'center',
  },
  metaLabel: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  metaValue: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  metaValueMono: {
    color: colors.amber,
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  cardActions: {
    flexDirection: 'row',
    gap: 10,
  },
  modalSub: {
    color: colors.textSecondary,
    fontSize: 13,
    marginBottom: 16,
    lineHeight: 18,
  },
  inputLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 6,
    marginTop: 12,
  },
  typeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeOption: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  typeOptionActive: {
    backgroundColor: colors.amberDark,
    borderColor: colors.amberDark,
  },
  typeOptionText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  typeOptionTextActive: {
    color: colors.white,
  },
  textInput: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    color: colors.textPrimary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  gpsIndicatorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: radii.md,
    padding: 10,
    marginTop: 14,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.25)',
  },
  gpsIndicatorText: {
    flex: 1,
    color: colors.amber,
    fontSize: 11,
    lineHeight: 15,
  },
});
