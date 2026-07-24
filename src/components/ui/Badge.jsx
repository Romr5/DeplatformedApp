import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radii } from '../../theme';

export function Badge({ children, variant = 'default', style, textStyle }) {
  const v = {
    default:     { bg: colors.amberDark, fg: colors.white, border: 'transparent' },
    secondary:   { bg: colors.surfaceAlt, fg: colors.textPrimary, border: 'transparent' },
    success:     { bg: 'rgba(16, 185, 129, 0.16)', fg: colors.signal, border: 'rgba(16, 185, 129, 0.35)' },
    warning:     { bg: 'rgba(245, 158, 11, 0.16)', fg: colors.amber, border: 'rgba(245, 158, 11, 0.35)' },
    destructive: { bg: 'rgba(239, 68, 68, 0.18)', fg: colors.danger, border: 'rgba(239, 68, 68, 0.35)' },
    outline:     { bg: 'transparent', fg: colors.textSecondary, border: colors.hairline },
  }[variant] || { bg: colors.surfaceAlt, fg: colors.textPrimary, border: 'transparent' };

  return (
    <View style={[styles.badge, { backgroundColor: v.bg, borderColor: v.border }, style]}>
      {typeof children === 'string' ? (
        <Text style={[styles.text, { color: v.fg }, textStyle]}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    borderWidth: 1,
    gap: 4,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
