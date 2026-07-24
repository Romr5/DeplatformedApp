import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radii } from '../../theme';

export function Avatar({ fallback = '?', size = 'default', tint = colors.amber, style, textStyle }) {
  const sizeValue = {
    sm: 32,
    default: 42,
    lg: 56,
    xl: 72,
  }[size] || (typeof size === 'number' ? size : 42);

  let cleanFallback = '?';
  if (typeof fallback === 'string' && fallback.trim().length > 0) {
    const trimmed = fallback.trim();
    const withoutEmoji = trimmed.replace(/^[\p{Emoji}\s]+/u, '').trim();
    if (withoutEmoji.length > 0) {
      cleanFallback = withoutEmoji.charAt(0).toUpperCase();
    } else {
      const chars = Array.from(trimmed);
      cleanFallback = chars[0] || '?';
    }
  }

  return (
    <View
      style={[
        styles.avatar,
        {
          width: sizeValue,
          height: sizeValue,
          borderRadius: sizeValue / 2,
          backgroundColor: colors.surfaceAlt,
          borderColor: colors.hairline,
        },
        style,
      ]}
    >
      <Text
        style={[
          styles.fallback,
          {
            color: tint || colors.amber,
            fontSize: Math.round(sizeValue * 0.42),
          },
          textStyle,
        ]}
      >
        {cleanFallback}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    overflow: 'hidden',
  },
  fallback: {
    fontWeight: '700',
  },
});
