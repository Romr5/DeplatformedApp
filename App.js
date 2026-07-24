/**
 * Demaline — Native Android App
 * Offline P2P mesh messenger using WiFi Direct + BLE
 *
 * WhatsApp-style UI Redesign based on C:\5BCA\meshapp
 */
import 'react-native-get-random-values';
import React, { useState, useContext, useEffect, useRef, useMemo } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  View, Text, Pressable, StyleSheet, ScrollView, Dimensions, BackHandler,
  Animated, Image, Platform,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppProvider, AppContext } from './src/AppContext';
import JoinScreen     from './src/screens/JoinScreen';
import ChatScreen     from './src/screens/ChatScreen';
import RoomsScreen    from './src/screens/RoomsScreen';
import BulletinScreen  from './src/screens/BulletinScreen';
import HelpScreen     from './src/screens/HelpScreen';
import PeersScreen    from './src/screens/PeersScreen';
import MapScreen      from './src/screens/MapScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import BottomTabBar   from './src/components/BottomTabBar';
import SplashLoader   from './src/components/SplashLoader';
import { IconSOS, IconClose } from './src/icons/Icons';
import { colors, radii } from './src/theme';
import { initP2P, requestPermissions, startDiscovery, resyncConnections } from './src/lib/p2p';

function MainApp() {
  const {
    initialized, profileLoaded, initializeApp, onDeviceDiscovered, onDeviceLost,
    handlePeerConnected, handlePeerDisconnected,
    handleIncomingConnectionRequest,
    myAlias, myEmoji, incomingSOSCount, tabNavigationRef,
    latestSOSAlert, dismissSOSAlert, activeConversation,
  } = useContext(AppContext);

  const insets = useSafeAreaInsets();
  const { width: windowWidth } = Dimensions.get('window');

  const [joined, setJoined] = useState(false);
  const [splashFinished, setSplashFinished] = useState(false);
  const [activeTab, setActiveTab] = useState(0); // 0: Mesh, 1: Chat, 2: Rooms, 3: Bulletin
  const [activeOverlay, setActiveOverlay] = useState(null); // 'Map' | 'Help' | 'Settings' | null
  const autoJoinStarted = useRef(false);
  const pagerRef = useRef(null);

  const isAppReady = Boolean(profileLoaded && (!myAlias || joined || initialized));

  // Unified navigation facade allowing swipeable main hub & dedicated screens
  const navigationFacade = useMemo(() => ({
    navigate: (name) => {
      if (name === 'Map' || name === 'Help' || name === 'Settings') {
        setActiveOverlay(name);
      } else if (name === 'Mesh') {
        setActiveOverlay(null);
        setActiveTab(0);
        pagerRef.current?.scrollTo({ x: 0, animated: true });
      } else if (name === 'Chat' || name === 'Chats') {
        setActiveOverlay(null);
        setActiveTab(1);
        pagerRef.current?.scrollTo({ x: windowWidth * 1, animated: true });
      } else if (name === 'Rooms') {
        setActiveOverlay(null);
        setActiveTab(2);
        pagerRef.current?.scrollTo({ x: windowWidth * 2, animated: true });
      } else if (name === 'Bulletin' || name === 'Board') {
        setActiveOverlay(null);
        setActiveTab(3);
        pagerRef.current?.scrollTo({ x: windowWidth * 3, animated: true });
      }
    },
    goBack: () => setActiveOverlay(null),
    emit: () => ({ defaultPrevented: false }),
  }), [windowWidth]);

  useEffect(() => {
    if (tabNavigationRef) {
      tabNavigationRef.current = navigationFacade;
    }
  }, [tabNavigationRef, navigationFacade]);

  // Android hardware back handler for overlays
  useEffect(() => {
    const onBackPress = () => {
      if (activeOverlay) {
        setActiveOverlay(null);
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [activeOverlay]);

  // Ensure pager scroll position matches activeTab whenever returning from overlays
  useEffect(() => {
    if (!activeOverlay && pagerRef.current) {
      setTimeout(() => {
        pagerRef.current?.scrollTo({ x: activeTab * windowWidth, animated: false });
      }, 50);
    }
  }, [activeOverlay, activeTab, windowWidth]);

  async function handleJoin(alias, emoji = '🧑') {
    if (!alias?.trim()) return;
    setJoined(true);

    try {
      await initializeApp(alias, emoji);
    } catch (e) {
      console.warn('[App] crypto init error:', e);
    }

    try {
      await requestPermissions();
      await initP2P({
        onPeerDiscovered:    onDeviceDiscovered,
        onPeerLost:          onDeviceLost,
        onPeerConnected:     (addr, name) => handlePeerConnected(addr, name),
        onPeerDisconnected:  (addr) => handlePeerDisconnected(addr),
        onConnectionRequest: (info) => {
          if (handleIncomingConnectionRequest) {
            handleIncomingConnectionRequest(info);
          }
        },
        onMessageReceived:   () => {},
      });
      await startDiscovery(alias);
      setTimeout(() => {
        resyncConnections().catch(() => {});
      }, 500);
    } catch (e) {
      console.warn('[App] p2p init error:', e);
    }
  }

  useEffect(() => {
    if (!myAlias) {
      setJoined(false);
      autoJoinStarted.current = false;
      return;
    }
    if (!profileLoaded || joined || initialized || autoJoinStarted.current) return;
    autoJoinStarted.current = true;
    handleJoin(myAlias, myEmoji);
  }, [profileLoaded, joined, initialized, myAlias, myEmoji]);

  if (!splashFinished) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar style="light" backgroundColor={colors.bg} />
        <SplashLoader
          isReady={isAppReady}
          onFinished={() => setSplashFinished(true)}
        />
      </View>
    );
  }

  if (!joined || !myAlias) {
    return <JoinScreen onJoin={handleJoin} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Compact Safe Area Aware SOS Notification Banner */}
      {latestSOSAlert && (
        <View style={[styles.emergencyBanner, { marginTop: Math.max(insets.top, 12) + 4 }]}>
          <View style={styles.emergencyIconWrap}>
            <IconSOS size={14} color={colors.white} />
          </View>
          <View style={{ flex: 1, marginHorizontal: 8 }}>
            <Text style={styles.emergencyTitle}>🚨 EMERGENCY DISTRESS BEACON</Text>
            <Text style={styles.emergencySender} numberOfLines={1}>
              {latestSOSAlert.alias || 'Mesh Peer'} • {latestSOSAlert.urgencyType?.toUpperCase() || 'DISTRESS'}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              if (dismissSOSAlert) dismissSOSAlert();
              setActiveOverlay('Help');
            }}
            style={styles.emergencyBtn}
            hitSlop={4}
          >
            <Text style={styles.emergencyBtnText}>VIEW</Text>
          </Pressable>
          <Pressable
            onPress={() => dismissSOSAlert && dismissSOSAlert()}
            style={{ padding: 4, marginLeft: 2 }}
            hitSlop={8}
          >
            <IconClose size={13} color="rgba(255, 255, 255, 0.85)" />
          </Pressable>
        </View>
      )}

      {/* Main Hub: Kept mounted so tab state and scroll offset are preserved */}
      <View style={{ flex: 1 }}>
        {/* Horizontal Swipeable Pager for Main Hub */}
        <ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEnabled={!activeConversation}
          keyboardShouldPersistTaps="handled"
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
            setActiveTab(idx);
          }}
          style={{ flex: 1 }}
        >
          <View style={{ width: windowWidth, flex: 1 }}>
            <PeersScreen navigation={navigationFacade} />
          </View>
          <View style={{ width: windowWidth, flex: 1 }}>
            <ChatScreen navigation={navigationFacade} />
          </View>
          <View style={{ width: windowWidth, flex: 1 }}>
            <RoomsScreen navigation={navigationFacade} />
          </View>
          <View style={{ width: windowWidth, flex: 1 }}>
            <BulletinScreen navigation={navigationFacade} />
          </View>
        </ScrollView>

        {/* Clean, Non-Congested 4-Tab Bar (Hidden in Active Chat) */}
        {!activeConversation && (
          <BottomTabBar
            state={{
              index: activeTab,
              routes: [
                { key: 'Mesh', name: 'Mesh' },
                { key: 'Chat', name: 'Chat' },
                { key: 'Rooms', name: 'Rooms' },
                { key: 'Bulletin', name: 'Bulletin' },
              ],
            }}
            navigation={navigationFacade}
            incomingSOSCount={incomingSOSCount}
          />
        )}
      </View>

      {/* Screen Render: Dedicated Overlays rendered cleanly on top */}
      {activeOverlay === 'Map' && (
        <View style={StyleSheet.absoluteFill}>
          <MapScreen navigation={navigationFacade} onBack={() => setActiveOverlay(null)} />
        </View>
      )}
      {activeOverlay === 'Help' && (
        <View style={StyleSheet.absoluteFill}>
          <HelpScreen navigation={navigationFacade} onBack={() => setActiveOverlay(null)} />
        </View>
      )}
      {activeOverlay === 'Settings' && (
        <View style={StyleSheet.absoluteFill}>
          <SettingsScreen navigation={navigationFacade} onBack={() => setActiveOverlay(null)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  emergencyBanner: {
    backgroundColor: 'rgba(220, 38, 38, 0.96)',
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 999,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  emergencyIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emergencyTitle: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  emergencySender: {
    color: 'rgba(255, 255, 255, 0.95)',
    fontSize: 11.5,
    fontWeight: '600',
    marginTop: 1,
  },
  emergencyBtn: {
    backgroundColor: colors.white,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  emergencyBtnText: {
    color: colors.danger,
    fontSize: 10,
    fontWeight: '800',
  },
});

export default function App() {
  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <AppProvider>
          <StatusBar style="light" backgroundColor={colors.bg} />
          <MainApp />
        </AppProvider>
      </View>
    </SafeAreaProvider>
  );
}
