import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, type, radii } from '../theme';

export const ScreenHeader = ({ title, subtitle, right }) => (
  <View style={styles.header}>
    <View style={{ flex: 1 }}>
      <Text style={type.h1}>{title}</Text>
      {subtitle ? <Text style={[type.caption, { marginTop: 2 }]}>{subtitle}</Text> : null}
    </View>
    {right}
  </View>
);

export const Pill = ({ children, tone = 'default', dot }) => {
  const toneStyle = {
    default: { bg: colors.surfaceAlt, fg: colors.textSecondary },
    ember: { bg: colors.emberGlow, fg: colors.ember },
    signal: { bg: colors.signalDim, fg: colors.signal },
    danger: { bg: colors.dangerDim, fg: colors.danger },
    warning: { bg: colors.warningDim, fg: colors.warning },
  }[tone] || { bg: colors.surfaceAlt, fg: colors.textSecondary };

  return (
    <View style={[styles.pill, { backgroundColor: toneStyle.bg }]}>
      {dot ? <View style={[styles.dot, { backgroundColor: toneStyle.fg }]} /> : null}
      <Text style={[type.caption, { color: toneStyle.fg, fontSize: 11.5 }]}>{children}</Text>
    </View>
  );
};

export const Avatar = ({ label = '?', size = 46, tint = colors.ember }) => {
  let cleanLabel = '?';
  if (typeof label === 'string' && label.trim().length > 0) {
    const trimmed = label.trim();
    const withoutEmoji = trimmed.replace(/^[\p{Emoji}\s]+/u, '').trim();
    if (withoutEmoji.length > 0) {
      cleanLabel = withoutEmoji.charAt(0).toUpperCase();
    } else {
      const chars = Array.from(trimmed);
      cleanLabel = chars[0] || '?';
    }
  }
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size * 0.32, backgroundColor: tint + '26', borderColor: tint }]}>
      <Text style={{ color: tint, fontSize: size * 0.4, fontWeight: '700' }}>{cleanLabel}</Text>
    </View>
  );
};

export const StatusDot = ({ online }) => (
  <View style={[styles.statusDot, { backgroundColor: online ? colors.signal : colors.textMuted }]} />
);

export const Divider = () => <View style={styles.divider} />;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 16,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.bg,
    position: 'absolute',
    right: -1,
    bottom: -1,
  },
  divider: { height: 1, backgroundColor: colors.hairline, marginHorizontal: 20 },
});
