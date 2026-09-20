import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { EntityGlyph } from '@/components/design/EntityGlyph';
import { palette } from '@/theme/design';
import { formatEntityStatus, formatEntityType } from '@/utils/presentation';
import type { EntityRecord } from '@/domain';

interface EntityRowProps {
  entity: EntityRecord;
  onPress: () => void;
  accent?: 'blue' | 'violet' | 'warm' | 'cyan';
  context?: string;
  isLast?: boolean;
}

export function EntityRow({ entity, onPress, accent = 'blue', context, isLast = false }: EntityRowProps) {
  const typeLabel = formatEntityType(entity.type);
  const statusLabel = formatEntityStatus(entity.status)
    ?? (entity.isPlaceholder ? 'Noch nicht vollständig eingeordnet' : 'Gespeichert');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${entity.title}, ${typeLabel}`}
      style={({ pressed }) => [styles.row, !isLast && styles.divider, pressed && styles.pressed]}
    >
      <EntityGlyph type={entity.type} size={43} accent={accent} />
      <View style={styles.copy}>
        <Text numberOfLines={2} style={styles.title}>{entity.title}</Text>
        <Text numberOfLines={1} style={styles.meta}>
          {context || `${typeLabel} · ${statusLabel}`}
        </Text>
        {entity.description ? <Text numberOfLines={2} style={styles.excerpt}>{entity.description}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={palette.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 72,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  pressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.035)',
  },
  copy: {
    flex: 1,
  },
  title: {
    color: palette.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '500',
  },
  meta: {
    marginTop: 3,
    color: palette.blue,
    fontSize: 10,
  },
  excerpt: {
    marginTop: 3,
    color: palette.textTertiary,
    fontSize: 10,
    lineHeight: 14,
  },
});
