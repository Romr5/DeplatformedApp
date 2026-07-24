import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing, StyleSheet } from 'react-native';
import { colors } from '../theme';
import { IconSatellite } from '../icons/Icons';

/**
 * Three staggered rings expand outward and fade, looping continuously,
 * plus a slow rotating sweep line — communicates "actively scanning"
 * without relying on a spinner or a generic ActivityIndicator.
 */
const Ring = ({ delay, size }) => {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(progress, {
          toValue: 1,
          duration: 2600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(progress, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [delay, progress]);

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1] });
  const opacity = progress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.55, 0] });

  return (
    <Animated.View
      style={[
        styles.ring,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          transform: [{ scale }],
          opacity,
        },
      ]}
    />
  );
};

const RadarSweep = ({ size = 220, scanning = true }) => {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!scanning) return;
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 3400, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [scanning, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      {scanning && (
        <>
          <Ring delay={0} size={size} />
          <Ring delay={900} size={size} />
          <Ring delay={1800} size={size} />
        </>
      )}
      <View style={[styles.dish, { width: size * 0.62, height: size * 0.62, borderRadius: (size * 0.62) / 2 }]}>
        {scanning && (
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
            <View style={styles.sweep} />
          </Animated.View>
        )}
        <IconSatellite size={size * 0.22} color={colors.textSecondary} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: colors.ember,
  },
  dish: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  sweep: {
    position: 'absolute',
    top: 0,
    left: '50%',
    width: '50%',
    height: '50%',
    backgroundColor: colors.emberGlow,
    borderTopRightRadius: 999,
  },
});

export default RadarSweep;
