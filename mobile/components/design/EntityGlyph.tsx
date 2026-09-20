import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { palette, radii } from '@/theme/design';

type IconName = ComponentProps<typeof Ionicons>['name'];

interface EntityGlyphProps {
  type?: string | null;
  size?: number;
  accent?: 'blue' | 'violet' | 'warm' | 'cyan';
}

const iconForType = (type?: string | null): IconName => {
  const normalized = type?.toLocaleLowerCase('de-DE') ?? '';
  if (normalized.includes('person')) return 'person';
  if (normalized.includes('organisation') || normalized.includes('organization')) return 'business';
  if (normalized.includes('document') || normalized.includes('rechnung')) return 'document-text';
  if (normalized.includes('event') || normalized.includes('ereignis')) return 'flash';
  if (normalized.includes('date') || normalized.includes('datum') || normalized.includes('termin')) return 'calendar';
  if (normalized.includes('task') || normalized.includes('aufgabe')) return 'checkmark-circle';
  if (normalized.includes('place') || normalized.includes('ort')) return 'location';
  if (normalized.includes('device') || normalized.includes('gerät')) return 'hardware-chip';
  if (normalized.includes('vehicle') || normalized.includes('fahrzeug')) return 'car-sport';
  if (normalized.includes('idea') || normalized.includes('idee')) return 'bulb';
  if (normalized.includes('relationship') || normalized.includes('verbindung')) return 'git-network';
  return 'sparkles';
};

const colors = {
  blue: ['rgba(72, 157, 255, 0.85)', 'rgba(62, 92, 230, 0.4)'],
  violet: ['rgba(161, 124, 255, 0.85)', 'rgba(85, 63, 190, 0.4)'],
  warm: ['rgba(255, 184, 102, 0.82)', 'rgba(196, 97, 67, 0.4)'],
  cyan: ['rgba(100, 216, 255, 0.82)', 'rgba(43, 116, 170, 0.4)'],
} as const;

export function EntityGlyph({ type, size = 44, accent = 'blue' }: EntityGlyphProps) {
  const iconSize = Math.max(18, Math.round(size * 0.46));
  return (
    <LinearGradient
      colors={colors[accent]}
      style={[styles.shell, { width: size, height: size, borderRadius: Math.min(radii.md, size / 2) }]}
    >
      <View style={styles.inner}>
        <Ionicons name={iconForType(type)} size={iconSize} color={palette.text} />
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  shell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(214, 232, 255, 0.4)',
    boxShadow: '0 0 18px rgba(72, 145, 255, 0.24)',
  },
  inner: {
    width: '76%',
    height: '76%',
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
});
