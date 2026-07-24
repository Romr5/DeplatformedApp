import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Image,
  Dimensions,
  Platform,
  Easing,
} from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('screen');

const TELEMETRY_STEPS = [
  'Initializing Cryptographic Vault & Keys...',
  'Activating Nearby BLE & Wi-Fi Direct Radio...',
  'Scanning Local Decentralized Mesh...',
  'Secure Radio Mesh Active',
];

export default function SplashLoader({ isReady = false, onFinished }) {
  const [stepIndex, setStepIndex] = useState(0);

  // Animations
  const ring1Scale = useRef(new Animated.Value(0.85)).current;
  const ring1Opacity = useRef(new Animated.Value(0.6)).current;
  const ring2Scale = useRef(new Animated.Value(0.85)).current;
  const ring2Opacity = useRef(new Animated.Value(0.4)).current;
  const ring3Scale = useRef(new Animated.Value(0.85)).current;
  const ring3Opacity = useRef(new Animated.Value(0.25)).current;

  const coreScale = useRef(new Animated.Value(0.96)).current;
  const masterFade = useRef(new Animated.Value(1)).current;
  const masterScale = useRef(new Animated.Value(1)).current;

  // Staggered Sonar Pulse Animations
  useEffect(() => {
    const createPulse = (scaleVal, opacityVal, delay) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(scaleVal, {
              toValue: 2.2,
              duration: 2200,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(opacityVal, {
              toValue: 0,
              duration: 2200,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(scaleVal, {
              toValue: 0.85,
              duration: 0,
              useNativeDriver: true,
            }),
            Animated.timing(opacityVal, {
              toValue: 0.6,
              duration: 0,
              useNativeDriver: true,
            }),
          ]),
        ])
      );
    };

    const pulse1 = createPulse(ring1Scale, ring1Opacity, 0);
    const pulse2 = createPulse(ring2Scale, ring2Opacity, 600);
    const pulse3 = createPulse(ring3Scale, ring3Opacity, 1200);

    // Core breathing animation
    const coreBreathing = Animated.loop(
      Animated.sequence([
        Animated.timing(coreScale, {
          toValue: 1.04,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(coreScale, {
          toValue: 0.96,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    pulse1.start();
    pulse2.start();
    pulse3.start();
    coreBreathing.start();

    return () => {
      pulse1.stop();
      pulse2.stop();
      pulse3.stop();
      coreBreathing.stop();
    };
  }, []);

  // Micro-step telemetry sequence
  useEffect(() => {
    const timer1 = setTimeout(() => setStepIndex(1), 300);
    const timer2 = setTimeout(() => setStepIndex(2), 650);
    const timer3 = setTimeout(() => setStepIndex(3), 1000);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, []);

  // Exit transition when ready (1.2s total sequence)
  useEffect(() => {
    let exitTimer = null;
    if (isReady) {
      exitTimer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(masterFade, {
            toValue: 0,
            duration: 350,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(masterScale, {
            toValue: 1.05,
            duration: 350,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start(() => {
          if (onFinished) onFinished();
        });
      }, 1200);
    }
    return () => {
      if (exitTimer) clearTimeout(exitTimer);
    };
  }, [isReady]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: masterFade,
          transform: [{ scale: masterScale }],
        },
      ]}
      pointerEvents="auto"
    >
      {/* Centered Main Block */}
      <View style={styles.centerBlock}>
        {/* Sonar Radar Canvas */}
        <View style={styles.sonarCanvas}>
          <Animated.View
            style={[
              styles.sonarRing,
              {
                transform: [{ scale: ring3Scale }],
                opacity: ring3Opacity,
              },
            ]}
          />
          <Animated.View
            style={[
              styles.sonarRing,
              {
                transform: [{ scale: ring2Scale }],
                opacity: ring2Opacity,
              },
            ]}
          />
          <Animated.View
            style={[
              styles.sonarRing,
              {
                transform: [{ scale: ring1Scale }],
                opacity: ring1Opacity,
              },
            ]}
          />

          {/* Ambient Glow Aura */}
          <View style={styles.aura} />

          {/* Central Core Emblem */}
          <Animated.View
            style={[
              styles.coreEmblem,
              {
                transform: [{ scale: coreScale }],
              },
            ]}
          >
            <Image
              source={require('../../assets/icon.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </Animated.View>
        </View>

        {/* Brand Identity */}
        <View style={styles.brandBox}>
          <Text style={styles.brandTitle}>DEPLATFORMED</Text>
          <View style={styles.pillBadge}>
            <View style={styles.activeDot} />
            <Text style={styles.pillText}>OFFLINE P2P MESH</Text>
          </View>
        </View>

        {/* Live Telemetry Micro-Progress */}
        <View style={styles.telemetryBox}>
          <View style={styles.telemetryDot} />
          <Text style={styles.telemetryText}>
            {TELEMETRY_STEPS[stepIndex]}
          </Text>
        </View>
      </View>

      {/* Footer Assurance at very bottom */}
      <View style={styles.footerBox}>
        <Text style={styles.footerText}>
          ZERO CLOUD · AES-256 / X3DH ENCRYPTED
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: '#09090b', // Deep zinc-950 obsidian
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99999,
  },
  centerBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingBottom: 40, // Offsets the visual center slightly above footer
  },
  sonarCanvas: {
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  sonarRing: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 1.5,
    borderColor: '#f59e0b', // Brand warm amber
  },
  aura: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
  },
  coreEmblem: {
    width: 86,
    height: 86,
    borderRadius: 24,
    backgroundColor: '#18181b', // zinc-900 elevated surface
    borderWidth: 2,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#f59e0b',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 8,
  },
  logoImage: {
    width: 58,
    height: 58,
    borderRadius: 14,
  },
  brandBox: {
    alignItems: 'center',
    marginBottom: 24,
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f4f4f5',
    letterSpacing: 6,
    textAlign: 'center',
    marginBottom: 10,
  },
  pillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.25)',
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981', // emerald-500 radio link indicator
    marginRight: 7,
  },
  pillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#f59e0b',
    letterSpacing: 2,
  },
  telemetryBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    height: 32,
  },
  telemetryDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#f59e0b',
    marginRight: 9,
  },
  telemetryText: {
    fontSize: 12,
    color: '#a1a1aa',
    letterSpacing: 0.5,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  footerBox: {
    position: 'absolute',
    bottom: 48,
    width: '100%',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 10,
    color: '#52525b',
    letterSpacing: 2.5,
    fontWeight: '600',
  },
});
