import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { AppBackground } from '@/components/design/AppBackground';
import { EntityRow } from '@/components/design/EntityRow';
import { GlassPanel } from '@/components/design/GlassPanel';
import { NaturalSearchField } from '@/components/design/NaturalSearchField';
import { ScreenHeader } from '@/components/design/ScreenHeader';
import { KnowledgeConstellation } from '@/components/knowledge/KnowledgeConstellation';
import { Text } from '@/components/ui/Text';
import { useApplicationServices } from '@/providers/ApplicationProvider';
import { palette, radii } from '@/theme/design';
import { isVisibleKnowledge } from '@/utils/presentation';
import type { EntityRecord } from '@/domain';

const accents = ['blue', 'violet', 'cyan', 'warm'] as const;

export default function KnowledgeScreen() {
  const router = useRouter();
  const services = useApplicationServices();
  const [query, setQuery] = useState('');
  const [entities, setEntities] = useState<EntityRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const openEntity = useCallback((entity: EntityRecord) => {
    router.push({ pathname: '/entity/[id]', params: { id: entity.id } });
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      const sequence = requestSequence.current + 1;
      requestSequence.current = sequence;
      const trimmed = query.trim();
      const timeout = setTimeout(() => {
        setIsLoading(true);
        setError(null);
        const request = trimmed ? services.search(trimmed, 30) : services.listRecent(12);
        void request
          .then((nextEntities) => {
            if (requestSequence.current === sequence) {
              setEntities(nextEntities.filter(isVisibleKnowledge));
            }
          })
          .catch(() => {
            if (requestSequence.current === sequence) setError('Dein Wissen konnte gerade nicht durchsucht werden.');
          })
          .finally(() => {
            if (requestSequence.current === sequence) setIsLoading(false);
          });
      }, trimmed ? 180 : 0);

      return () => clearTimeout(timeout);
    }, [query, services]),
  );

  return (
    <AppBackground>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <ScreenHeader title="Mein Wissen" subtitle="Alles, was du festhältst, an einem Ort." />

          <View style={styles.searchWrap}>
            <NaturalSearchField
              value={query}
              onChangeText={setQuery}
              placeholder="Was habe ich über den Kühlschrank gesagt?"
            />
          </View>

          {!query.trim() && entities.length > 0 ? (
            <GlassPanel animatedHighlight style={styles.graphPanel}>
              <View style={styles.graphHeader}>
                <View>
                  <Text style={styles.graphTitle}>Wissensübersicht</Text>
                  <Text style={styles.graphSubtitle}>Eine lebendige Auswahl deiner zuletzt erfassten Inhalte.</Text>
                </View>
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>Auswahl</Text>
                </View>
              </View>
              <KnowledgeConstellation entities={entities} onSelect={openEntity} />
            </GlassPanel>
          ) : null}

          <View style={styles.resultsHeader}>
            <View>
              <Text style={styles.resultsTitle}>{query.trim() ? 'Ergebnisse' : 'Zuletzt erfasst'}</Text>
              <Text style={styles.resultsSubtitle}>
                {query.trim() ? `${entities.length} passende Informationen` : 'Menschen, Dinge und Erlebnisse aus deinem Wissen'}
              </Text>
            </View>
            {query.trim() ? <Ionicons name="sparkles" size={17} color={palette.warm} /> : null}
          </View>

          {isLoading ? (
            <ActivityIndicator color={palette.blue} style={styles.loader} />
          ) : error ? (
            <GlassPanel style={styles.statePanel}>
              <Ionicons name="alert-circle-outline" size={24} color={palette.danger} />
              <Text style={styles.stateText}>{error}</Text>
            </GlassPanel>
          ) : entities.length > 0 ? (
            <GlassPanel style={styles.resultsPanel}>
              {entities.map((entity, index) => (
                <EntityRow
                  key={entity.id}
                  entity={entity}
                  accent={accents[index % accents.length]}
                  onPress={() => openEntity(entity)}
                  isLast={index === entities.length - 1}
                />
              ))}
            </GlassPanel>
          ) : (
            <GlassPanel style={styles.statePanel}>
              <Ionicons name={query.trim() ? 'search-outline' : 'sparkles-outline'} size={27} color={palette.blue} />
              <Text style={styles.stateTitle}>{query.trim() ? 'Noch nichts Passendes' : 'Dein Wissen beginnt hier'}</Text>
              <Text style={styles.stateText}>
                {query.trim()
                  ? 'Formuliere die Frage etwas anders oder sprich direkt mit deiner KI.'
                  : 'Sobald du etwas erzählst oder schreibst, entsteht hier dein persönliches Wissensnetz.'}
              </Text>
            </GlassPanel>
          )}
        </ScrollView>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 120,
  },
  searchWrap: {
    marginTop: 20,
  },
  graphPanel: {
    marginTop: 18,
    borderRadius: radii.xl,
  },
  graphHeader: {
    paddingHorizontal: 18,
    paddingTop: 18,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  graphTitle: {
    color: palette.text,
    fontSize: 17,
    fontWeight: '600',
  },
  graphSubtitle: {
    maxWidth: 245,
    marginTop: 4,
    color: palette.textTertiary,
    fontSize: 10,
    lineHeight: 15,
  },
  livePill: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 252, 247, 0.055)',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.blue,
  },
  liveText: {
    color: palette.textSecondary,
    fontSize: 9,
  },
  resultsHeader: {
    marginTop: 25,
    marginBottom: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resultsTitle: {
    color: palette.text,
    fontSize: 18,
    fontWeight: '600',
  },
  resultsSubtitle: {
    marginTop: 3,
    color: palette.textTertiary,
    fontSize: 10,
  },
  loader: {
    marginVertical: 35,
  },
  resultsPanel: {
    borderRadius: radii.lg,
  },
  statePanel: {
    paddingHorizontal: 24,
    paddingVertical: 30,
    borderRadius: radii.lg,
    alignItems: 'center',
    gap: 9,
  },
  stateTitle: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  stateText: {
    maxWidth: 280,
    color: palette.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
