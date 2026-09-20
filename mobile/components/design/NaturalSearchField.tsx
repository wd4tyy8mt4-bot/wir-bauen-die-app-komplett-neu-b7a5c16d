import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { GlassPanel } from '@/components/design/GlassPanel';
import { palette, radii } from '@/theme/design';

interface NaturalSearchFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
}

export function NaturalSearchField({
  value,
  onChangeText,
  placeholder = 'Was möchtest du über dein Wissen wissen?',
}: NaturalSearchFieldProps) {
  return (
    <GlassPanel style={styles.shell} strong>
      <View style={styles.content}>
        <Ionicons name="search" size={19} color={palette.textSecondary} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={palette.textTertiary}
          autoCapitalize="sentences"
          returnKeyType="search"
          accessibilityLabel="Wissen in natürlicher Sprache durchsuchen"
          style={styles.input}
        />
        {value ? (
          <Pressable
            onPress={() => onChangeText('')}
            accessibilityRole="button"
            accessibilityLabel="Suche löschen"
            hitSlop={10}
          >
            <Ionicons name="close-circle" size={19} color={palette.textTertiary} />
          </Pressable>
        ) : (
          <Ionicons name="mic" size={18} color={palette.blue} />
        )}
      </View>
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: radii.pill,
  },
  content: {
    minHeight: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  input: {
    flex: 1,
    color: palette.text,
    fontSize: 13,
    paddingVertical: 12,
  },
});
