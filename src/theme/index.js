/**
 * DESIGN SYSTEM — Deplatformed App (from C:\5BCA\meshapp)
 * ------------------------------------------------------------------
 * Ink & ember WhatsApp-style aesthetic:
 * - Ink & ember palette (deep warm charcoal, not pure #000 or #0b0b12)
 * - Ember/coral & WhatsApp teal signal accents
 * - Clean SVG line icons, no emojis
 * - Clean WhatsApp-like message bubbles, day dividers, delivery checks
 */
import { Platform } from 'react-native';

export const colors = {
  // DML Dark Zinc Palette (Obsidian / Zinc)
  bg: '#09090b',          // zinc-950
  bgElevated: '#18181b',  // zinc-900
  surface: '#18181b',     // zinc-900 card surface
  surfaceAlt: '#27272a',  // zinc-800 secondary surface / input
  hairline: '#27272a',    // zinc-800 border
  borderMuted: '#3f3f46', // zinc-700 subtle border

  // Text
  textPrimary: '#f4f4f5',   // zinc-100
  textSecondary: '#a1a1aa', // zinc-400
  textMuted: '#71717a',     // zinc-500
  textDisabled: '#52525b',  // zinc-600

  // Brand — DML Warm Amber
  amber: '#f59e0b',       // amber-500
  amberDark: '#d97706',   // amber-600
  amberDim: 'rgba(245, 158, 11, 0.15)',
  amberGlow: 'rgba(245, 158, 11, 0.25)',

  // Backward compatibility alias for ember -> amber
  ember: '#f59e0b',
  emberDim: 'rgba(245, 158, 11, 0.15)',
  emberGlow: 'rgba(245, 158, 11, 0.25)',

  // Secondary accents
  signal: '#10b981',       // emerald-500 (paired / active)
  signalDim: 'rgba(16, 185, 129, 0.16)',
  emerald: '#10b981',
  emeraldDim: 'rgba(16, 185, 129, 0.16)',

  // Status
  danger: '#ef4444',       // red-500 (SOS / destructive)
  dangerDim: 'rgba(239, 68, 68, 0.18)',
  warning: '#f59e0b',      // amber-500
  warningDim: 'rgba(245, 158, 11, 0.16)',

  // Utility
  blue: '#3b82f6',         // blue-500 (user location)
  blueDim: 'rgba(59, 130, 246, 0.16)',
  white: '#ffffff',
  overlay: 'rgba(0, 0, 0, 0.75)',

  // Zinc scale constants
  zinc950: '#09090b',
  zinc900: '#18181b',
  zinc800: '#27272a',
  zinc700: '#3f3f46',
  zinc600: '#52525b',
  zinc500: '#71717a',
  zinc400: '#a1a1aa',
  zinc300: '#d4d4d8',
  zinc200: '#e4e4e7',
  zinc100: '#f4f4f5',
};

export const fonts = {
  display: Platform.select({ android: 'sans-serif-medium', ios: 'System', default: 'System' }),
  displayItalic: Platform.select({ android: 'sans-serif-light', ios: 'System', default: 'System' }),
  body: Platform.select({ android: 'sans-serif', ios: 'System', default: 'System' }),
  bodyMedium: Platform.select({ android: 'sans-serif-medium', ios: 'System', default: 'System' }),
  bodySemiBold: Platform.select({ android: 'sans-serif-medium', ios: 'System', default: 'System' }),
  mono: Platform.select({ android: 'monospace', default: 'Courier' }),
};

export const type = {
  h1: { fontFamily: fonts.display, fontSize: 24, color: colors.textPrimary, letterSpacing: -0.2, fontWeight: '700' },
  h2: { fontFamily: fonts.display, fontSize: 19, color: colors.textPrimary, letterSpacing: -0.1, fontWeight: '700' },
  label: { fontFamily: fonts.bodyMedium, fontSize: 12, letterSpacing: 0.4, color: colors.textMuted, fontWeight: '600' },
  body: { fontFamily: fonts.body, fontSize: 15, color: colors.textPrimary, lineHeight: 21 },
  bodyMedium: { fontFamily: fonts.bodyMedium, fontSize: 15, color: colors.textPrimary, fontWeight: '500', lineHeight: 21 },
  caption: { fontFamily: fonts.body, fontSize: 12.5, color: colors.textSecondary, lineHeight: 17 },
  mono: { fontFamily: fonts.mono, fontSize: 12, color: colors.textSecondary },
};

export const spacing = (n) => n * 4;

export const radii = {
  sm: 10,
  md: 16,
  lg: 22,
  pill: 999,
};

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  glow: (color) => ({
    shadowColor: color,
    shadowOpacity: 0.55,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  }),
};

export default { colors, fonts, type, spacing, radii, shadow };
