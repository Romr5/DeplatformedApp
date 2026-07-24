import React from 'react';
import { Pressable, Text, StyleSheet, View } from 'react-native';
import { colors, radii } from '../../theme';

export function Button({
  children,
  variant = 'default',
  size = 'default',
  onPress,
  disabled = false,
  style,
  textStyle,
  icon,
}) {
  const v = {
    default:   { bg: colors.amberDark, fg: colors.white, border: 'transparent' },
    secondary: { bg: colors.surfaceAlt, fg: colors.textPrimary, border: 'transparent' },
    outline:   { bg: 'transparent', fg: colors.textPrimary, border: colors.hairline },
    danger:    { bg: 'rgba(239, 68, 68, 0.16)', fg: colors.danger, border: 'rgba(239, 68, 68, 0.35)' },
    ghost:     { bg: 'transparent', fg: colors.textSecondary, border: 'transparent' },
  }[variant] || { bg: colors.amberDark, fg: colors.white, border: 'transparent' };

  const s = {
    sm:      { py: 6, px: 12, fontSize: 12, height: 32 },
    default: { py: 10, px: 16, fontSize: 14, height: 42 },
    lg:      { py: 14, px: 22, fontSize: 16, height: 50 },
    icon:    { py: 8, px: 8, fontSize: 14, height: 40, width: 40 },
  }[size] || { py: 10, px: 16, fontSize: 14, height: 42 };

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: v.bg,
          borderColor: v.border,
          paddingVertical: s.py,
          paddingHorizontal: s.px,
          minHeight: s.height,
        },
        s.width ? { width: s.width, paddingHorizontal: 0 } : null,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <View style={styles.contentRow}>
        {icon}
        {typeof children === 'string' ? (
          <Text style={[styles.text, { color: v.fg, fontSize: s.fontSize }, textStyle]}>
            {children}
          </Text>
        ) : (
          children
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  text: {
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  disabled: {
    opacity: 0.45,
  },
});
