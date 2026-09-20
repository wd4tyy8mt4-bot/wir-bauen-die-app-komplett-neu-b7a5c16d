import { useCallback, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { AppBackground } from '@/components/design/AppBackground';
import { EntityRow } from '@/components/design/EntityRow';
import { GlassPanel } from '@/components/design/GlassPanel';
import { ScreenHeader } from '@/components/design/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { useApplicationServices } from '@/providers/ApplicationProvider';
import { palette, radii } from '@/theme/design';
import { formatEntityStatus, isVisibleKnowledge } from '@/utils/presentation';
import type { EntityRecord } from '@/domain';

export default function TasksScreen() {
  const router = useRouter();
  const services = useApplicationServices();
  const [tasks, setTasks] = useState<EntityRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const entities = await services.listRecent(200);
      setTasks(
        entities.filter(
          (entity) => entity.type === 'task' && !entity.resolvedEntityId && isVisibleKnowledge(entity),
        ),
      );
    } catch {
      setError('Deine Aufgaben konnten gerade nicht geladen werden.');
    } finally {
      setIsLoading(false);
    }
  }, [services]);

  useFocusEffect(useCallback(() => {
    void loadTasks();
  }, [loadTasks]));

  return (
    <AppBackground>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ScreenHeader title="Aufgaben" subtitle="Was du dir vorgenommen hast, klar und ohne Ablenkung." />

          <GlassPanel style={styles.summaryPanel} strong>
            <View style={styles.summaryContent}>
              <View style={styles.summaryIcon}><Ionicons name="checkbox" size={23} color={palette.text} /></View>
              <View style={styles.summaryCopy}>
                <Text style={styles.summaryNumber}>{tasks.length}</Text>
                <Text style={styles.summaryLabel}>{tasks.length === 1 ? 'erfasste Aufgabe' : 'erfasste Aufgaben'}</Text>
              </View>
              <View style={styles.localPill}><View style={styles.localDot} /><Text style={styles.localText}>Lokal</Text></View>
            </View>
          </GlassPanel>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Deine Aufgaben</Text>
            <Text style={styles.sectionMeta}>Für dich erkannt</Text>
          </View>

          {isLoading ? (
            <ActivityIndicator color={palette.blue} style={styles.loader} />
          ) : error ? (
            <GlassPanel style={styles.statePanel}>
              <Ionicons name="alert-circle-outline" size={25} color={palette.danger} />
              <Text style={styles.stateText}>{error}</Text>
            </GlassPanel>
          ) : tasks.length > 0 ? (
            <GlassPanel style={styles.tasksPanel}>
              {tasks.map((task, index) => (
                <EntityRow
                  key={task.id}
                  entity={task}
                  accent="cyan"
                  context={formatEntityStatus(task.status) || 'Aufgabe'}
                  isLast={index === tasks.length - 1}
                  onPress={() => router.push({ pathname: '/entity/[id]', params: { id: task.id } })}
                />
              ))}
            </GlassPanel>
          ) : (
            <GlassPanel style={styles.statePanel} strong>
              <View style={styles.emptyIcon}><Ionicons name="checkmark-done" size={29} color={palette.success} /></View>
              <Text style={styles.stateTitle}>Alles ruhig</Text>
              <Text style={styles.stateText}>Wenn du dir etwas vornimmst, merke ich es mir hier für dich.</Text>
            </GlassPanel>
          )}
        </ScrollView>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 120 },
  summaryPanel: { marginTop: 22, borderRadius: radii.xl },
  summaryContent: { minHeight: 98, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 14 },
  summaryIcon: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(83, 142, 255, 0.22)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(125, 178, 255, 0.36)' },
  summaryCopy: { flex: 1 },
  summaryNumber: { color: palette.text, fontSize: 25, fontWeight: '600' },
  summaryLabel: { marginTop: 2, color: palette.textSecondary, fontSize: 11 },
  localPill: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: radii.pill, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(113, 230, 177, 0.08)' },
  localDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.success },
  localText: { color: palette.success, fontSize: 9 },
  sectionHeader: { marginTop: 27, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: palette.text, fontSize: 18, fontWeight: '600' },
  sectionMeta: { color: palette.textTertiary, fontSize: 10 },
  loader: { marginVertical: 35 },
  tasksPanel: { borderRadius: radii.lg },
  statePanel: { minHeight: 230, padding: 28, borderRadius: radii.xl, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyIcon: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(113, 230, 177, 0.09)' },
  stateTitle: { color: palette.text, fontSize: 18, fontWeight: '600' },
  stateText: { maxWidth: 270, color: palette.textSecondary, fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
