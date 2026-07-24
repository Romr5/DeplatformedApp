import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Animated,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii } from '../theme';
import { Button } from '../components/ui/Button';
import { Avatar } from '../components/ui/Avatar';
import {
  IconRadioTower,
  IconShieldCheck,
  IconBattery,
  IconLock,
} from '../icons/Icons';

export default function JoinScreen({ onJoin }) {
  const [alias, setAlias] = useState('');
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const insets = useSafeAreaInsets();

  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim, step]);

  async function handleComplete() {
    if (!alias.trim() || loading) return;
    setLoading(true);
    try {
      await onJoin(alias.trim(), '👤');
    } catch {
      setLoading(false);
    }
  }

  const initial = alias.trim() ? alias.trim().charAt(0).toUpperCase() : '?';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 20) }]}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Animated.View style={[styles.innerContent, { opacity: fadeAnim }]}>
          {step === 1 ? (
            <>
              {/* App Logo Badge */}
              <View style={[styles.iconCircle, { backgroundColor: 'transparent', borderWidth: 0 }]}>
                <Image
                  source={require('../../assets/icon.png')}
                  style={{ width: 84, height: 84, borderRadius: 20 }}
                  resizeMode="contain"
                />
              </View>

              <Text style={styles.title}>Welcome to Deplatformed</Text>
              <Text style={styles.subtitle}>
                Offline-first peer-to-peer mesh messenger for when everything else fails.
              </Text>

              {/* Avatar Preview */}
              <View style={styles.avatarPreviewWrap}>
                <Avatar
                  fallback={initial}
                  size="xl"
                  tint={colors.amber}
                  style={styles.avatarLarge}
                />
              </View>

              {/* Alias Input */}
              <View style={styles.inputWrap}>
                <Text style={styles.inputLabel}>CHOOSE YOUR DISPLAY NAME</Text>
                <TextInput
                  style={styles.input}
                  value={alias}
                  onChangeText={setAlias}
                  placeholder="e.g. Alex or Radio-01"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="words"
                  maxLength={24}
                  returnKeyType="next"
                  onSubmitEditing={() => {
                    if (alias.trim()) setStep(2);
                  }}
                />
                <Text style={styles.inputHint}>Visible to nearby mesh nodes on BLE and Wi-Fi Direct</Text>
              </View>

              <Button
                variant="default"
                size="lg"
                style={styles.continueBtn}
                disabled={!alias.trim()}
                onPress={() => {
                  if (alias.trim()) setStep(2);
                }}
              >
                Continue →
              </Button>
            </>
          ) : (
            <>
              <Text style={styles.title}>How it Works</Text>
              <Text style={styles.subtitle}>
                Built for off-grid resilience, emergency communications, and zero-internet connectivity.
              </Text>

              {/* Features List (DML Signature) */}
              <View style={styles.featureList}>
                <View style={styles.featureItem}>
                  <View style={styles.featureIconWrap}>
                    <IconRadioTower size={22} color={colors.amber} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.featureHeading}>Zero Internet Required</Text>
                    <Text style={styles.featureDesc}>
                      Communicates directly device-to-device over Bluetooth LE and Wi-Fi Direct radio clusters.
                    </Text>
                  </View>
                </View>

                <View style={styles.featureItem}>
                  <View style={styles.featureIconWrap}>
                    <IconShieldCheck size={22} color={colors.signal} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.featureHeading}>Signal Double Ratchet E2EE</Text>
                    <Text style={styles.featureDesc}>
                      Forward secrecy and post-compromise security protect your 1:1 and group communications.
                    </Text>
                  </View>
                </View>

                <View style={styles.featureItem}>
                  <View style={styles.featureIconWrap}>
                    <IconBattery size={22} color={colors.amber} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.featureHeading}>Store-and-Forward Mesh Relaying</Text>
                    <Text style={styles.featureDesc}>
                      Packets hop through nearby devices automatically to extend radio reach up to 10 hops.
                    </Text>
                  </View>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 10, width: '100%', marginTop: 'auto' }}>
                <Button
                  variant="outline"
                  size="lg"
                  style={{ flex: 1 }}
                  onPress={() => setStep(1)}
                >
                  ← Back
                </Button>
                <Button
                  variant="default"
                  size="lg"
                  style={{ flex: 2 }}
                  disabled={loading}
                  onPress={handleComplete}
                >
                  {loading ? 'Initializing Mesh…' : 'Start Connecting'}
                </Button>
              </View>
            </>
          )}
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 40,
    justifyContent: 'flex-start',
  },
  innerContent: {
    alignItems: 'center',
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 16,
    maxWidth: 320,
  },
  avatarPreviewWrap: {
    marginBottom: 16,
  },
  avatarLarge: {
    borderWidth: 2,
    borderColor: colors.hairline,
  },
  inputWrap: {
    width: '100%',
    marginBottom: 18,
  },
  inputLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 8,
    textAlign: 'center',
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.md,
    color: colors.textPrimary,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  inputHint: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 6,
  },
  continueBtn: {
    width: '100%',
  },
  featureList: {
    width: '100%',
    gap: 16,
    marginBottom: 32,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.lg,
    padding: 16,
    gap: 14,
  },
  featureIconWrap: {
    width: 42,
    height: 42,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureHeading: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  featureDesc: {
    color: colors.textSecondary,
    fontSize: 12.5,
    lineHeight: 18,
  },
});
