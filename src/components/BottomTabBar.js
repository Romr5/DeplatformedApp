import React, { useEffect, useRef } from 'react';
import { View, Pressable, Text, Animated, StyleSheet, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import {
  IconChats,
  IconRooms,
  IconMegaphone,
  IconSOS,
  IconRadioTower,
  IconMap,
  IconGear,
} from '../icons/Icons';

const TAB_CONFIG = {
  Mesh:     { key: 'Mesh', label: 'Mesh', Icon: IconRadioTower },
  Chat:     { key: 'Chat', label: 'Chats', Icon: IconChats },
  Chats:    { key: 'Chats', label: 'Chats', Icon: IconChats },
  Rooms:    { key: 'Rooms', label: 'Rooms', Icon: IconRooms },
  Bulletin: { key: 'Bulletin', label: 'Board', Icon: IconMegaphone },
  Board:    { key: 'Board', label: 'Board', Icon: IconMegaphone },
  Map:      { key: 'Map', label: 'Map', Icon: IconMap },
  Help:     { key: 'Help', label: 'SOS', Icon: IconSOS, isAlert: true },
  SOS:      { key: 'SOS', label: 'SOS', Icon: IconSOS, isAlert: true },
  Settings: { key: 'Settings', label: 'Settings', Icon: IconGear },
};

const BottomTabBar = ({ state, navigation, incomingSOSCount = 0 }) => {
  const insets = useSafeAreaInsets();
  const indicator = useRef(new Animated.Value(state.index)).current;
  const tabCount = Math.max(state.routes.length, 1);
  const { width } = Dimensions.get('window');
  const tabWidth = width / tabCount;

  useEffect(() => {
    Animated.spring(indicator, {
      toValue: state.index,
      useNativeDriver: true,
      damping: 18,
      stiffness: 200,
    }).start();
  }, [state.index, indicator]);

  const translateX = indicator.interpolate({
    inputRange: state.routes.map((_, i) => i),
    outputRange: state.routes.map((_, i) => i * tabWidth + tabWidth / 2 - 12),
  });

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <Animated.View style={[styles.indicator, { transform: [{ translateX }] }]} />
      <View style={styles.tabRow}>
        {state.routes.map((route, index) => {
          const tab = TAB_CONFIG[route.name] || { key: route.name, label: route.name, Icon: IconChats };
          const focused = state.index === index;
          const color = tab.isAlert
            ? colors.danger
            : focused
            ? colors.amber
            : colors.textMuted;
          const isSOS = tab.key === 'Help' || tab.key === 'SOS';
          const hasSOSBadge = isSOS && incomingSOSCount > 0;

          return (
            <Pressable
              key={route.key}
              onPress={() => {
                const event = (navigation && navigation.emit)
                  ? navigation.emit({
                      type: 'tabPress',
                      target: route.key,
                      canPreventDefault: true,
                    })
                  : { defaultPrevented: false };
                if (!focused && !event.defaultPrevented && navigation?.navigate) {
                  navigation.navigate(route.name);
                }
              }}
              style={styles.tab}
              android_ripple={{ color: colors.hairline, borderless: true, radius: 26 }}
            >
              <View style={[styles.iconWrap, focused && styles.iconWrapActive, tab.isAlert && styles.iconWrapAlert]}>
                <tab.Icon size={19} color={color} strokeWidth={focused ? 2.2 : 1.7} />
                {hasSOSBadge && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{incomingSOSCount > 9 ? '9+' : incomingSOSCount}</Text>
                  </View>
                )}
              </View>
              <Text
                style={[
                  styles.label,
                  { color },
                  focused && styles.labelFocused,
                ]}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(9, 9, 11, 0.96)',
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingTop: 6,
    position: 'relative',
  },
  indicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 24,
    height: 2.5,
    borderRadius: 1.5,
    backgroundColor: colors.amber,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: 52,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  iconWrap: {
    width: 32,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  iconWrapActive: {},
  iconWrapAlert: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderRadius: 14,
  },
  label: {
    fontSize: 10,
    fontWeight: '500',
    marginTop: 2,
    letterSpacing: 0.3,
  },
  labelFocused: {
    fontWeight: '700',
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -7,
    backgroundColor: colors.danger,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
  badgeText: {
    color: colors.white,
    fontSize: 9,
    fontWeight: '800',
  },
});

export default BottomTabBar;
