import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { AppBackground } from '@/components/design/AppBackground';
import { EntityGlyph } from '@/components/design/EntityGlyph';
import { GlassPanel } from '@/components/design/GlassPanel';
import { useApplicationServices } from '@/providers/ApplicationProvider';
import { palette, radii } from '@/theme/design';
import {
  formatAliasKind,
  formatAttributeLabel,
  formatEntityStatus,
  formatEntityType,
  formatRelationshipType,
  formatSourceType,
} from '@/utils/presentation';
import type { EntityDetails, JsonValue, RelationshipRecord } from '@/domain';

type DetailTab = 'details' | 'connections' | 'sources';


function formatValue(value: JsonValue): string {
  if (value === null) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return new Intl.NumberFormat('de-DE').format(value);
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
  if (Array.isArray(value)) return value.map(formatValue).join(', ');
  return Object.entries(value)
    .map(([key, entry], index) => `${formatAttributeLabel(key, index)}: ${formatValue(entry)}`)
    .join(' · ');
}

function counterpartId(relationship: RelationshipRecord, entityId: string): string {
  return relationship.sourceEntityId === entityId ? relationship.targetEntityId : relationship.sourceEntityId;
}

export default function EntityDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const entityId = Array.isArray(params.id) ? params.id[0] : params.id;
  const services = useApplicationServices();
  const [details, setDetails] = useState<EntityDetails | null>(null);
  const [relatedTitles, setRelatedTitles] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<DetailTab>('details');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDetails = useCallback(async () => {
    if (!entityId) {
      setError('Diese Information konnte nicht gefunden werden.');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const nextDetails = await services.getEntityDetails(entityId);
      if (!nextDetails) {
        setDetails(null);
        setError('Diese Information ist nicht mehr verfügbar.');
        return;
      }
      setDetails(nextDetails);
      const relatedIds = Array.from(new Set(nextDetails.relationships.map((relationship) => counterpartId(relationship, entityId))));
      const related = await Promise.all(relatedIds.map(async (id) => [id, (await services.getEntityDetails(id))?.entity.title] as const));
      setRelatedTitles(Object.fromEntries(related.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))));
    } catch {
      setError('Die Details konnten gerade nicht geladen werden.');
    } finally {
      setIsLoading(false);
    }
  }, [entityId, services]);

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);


  return (
    <AppBackground>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Zurück" style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color={palette.text} />
          </Pressable>
          <View style={styles.topBarMark}>
            <Ionicons name="shield-checkmark-outline" size={16} color={palette.textSecondary} />
          </View>
        </View>

        {isLoading ? (
          <View style={styles.centerState}><ActivityIndicator color={palette.blue} /></View>
        ) : error || !details ? (
          <View style={styles.centerState}>
            <Ionicons name="alert-circle-outline" size={28} color={palette.danger} />
            <Text style={styles.errorText}>{error || 'Diese Information konnte nicht geladen werden.'}</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.hero}>
              <EntityGlyph type={details.entity.type} size={72} />
              <Text style={styles.title}>{details.entity.title}</Text>
              <Text style={styles.type}>{formatEntityType(details.entity.type)}</Text>

            </View>

            <GlassPanel style={styles.tabsPanel}>
              <View style={styles.tabs}>
                {([
                  ['details', 'Details'],
                  ['connections', 'Verbindungen'],
                  ['sources', 'Quellen'],
                ] as const).map(([key, label]) => (
                  <Pressable key={key} onPress={() => setActiveTab(key)} style={styles.tabButton}>
                    {activeTab === key ? (
                      <LinearGradient colors={['rgba(217, 163, 95, 0.22)', 'rgba(62, 61, 58, 0.42)']} style={styles.activeTab}>
                        <Text style={styles.activeTabText}>{label}</Text>
                      </LinearGradient>
                    ) : (
                      <Text style={styles.tabText}>{label}</Text>
                    )}
                  </Pressable>
                ))}
              </View>
            </GlassPanel>

            {activeTab === 'details' ? (
              <View style={styles.stack}>
                <GlassPanel style={styles.sectionPanel}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Angaben</Text>
                    <Text style={styles.sectionCount}>{details.attributes.length + 2}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Kategorie</Text>
                    <Text style={styles.detailValue}>{formatEntityType(details.entity.type)}</Text>
                  </View>
                  {details.entity.status ? (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Bearbeitungsstand</Text>
                      <Text style={styles.detailValue}>{formatEntityStatus(details.entity.status) ?? 'Gespeichert'}</Text>
                    </View>
                  ) : null}
                  {details.attributes.map((attribute) => (
                    <View key={attribute.id} style={styles.detailRow}>
                      <Text style={styles.detailLabel}>{formatAttributeLabel(attribute.key)}</Text>
                      <Text style={styles.detailValue}>{formatValue(attribute.value)}</Text>
                    </View>
                  ))}
                  {details.entity.description ? (
                    <View style={styles.descriptionBox}>
                      <Text style={styles.description}>{details.entity.description}</Text>
                    </View>
                  ) : null}
                </GlassPanel>

                {details.events.length > 0 ? (
                  <GlassPanel style={styles.sectionPanel}>
                    <View style={styles.sectionHeader}>
                      <Text style={styles.sectionTitle}>Ereignisse</Text>
                      <Text style={styles.sectionCount}>{details.events.length}</Text>
                    </View>
                    {details.events.map((event) => (
                      <View key={event.id} style={styles.itemRow}>
                        <View style={styles.smallIcon}><Ionicons name="flash" size={15} color={palette.warm} /></View>
                        <View style={styles.itemCopy}>
                          <Text style={styles.itemTitle}>{event.title}</Text>
                          <Text style={styles.itemMeta}>{formatEntityType(event.type)}{event.occurredAt ? ` · ${new Date(event.occurredAt).toLocaleDateString('de-DE')}` : ''}</Text>
                        </View>
                      </View>
                    ))}
                  </GlassPanel>
                ) : null}
              </View>
            ) : null}

            {activeTab === 'connections' ? (
              <GlassPanel style={styles.sectionPanel}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Verbindungen</Text>
                  <Text style={styles.sectionCount}>{details.relationships.length}</Text>
                </View>
                {details.relationships.length > 0 ? details.relationships.map((relationship) => {
                  const relatedId = counterpartId(relationship, details.entity.id);
                  return (
                    <Pressable
                      key={relationship.id}
                      onPress={() => router.push({ pathname: '/entity/[id]', params: { id: relatedId } })}
                      style={({ pressed }) => [styles.itemRow, pressed && styles.pressed]}
                    >
                      <View style={styles.smallIcon}><Ionicons name="git-network" size={16} color={palette.warm} /></View>
                      <View style={styles.itemCopy}>
                        <Text style={styles.itemTitle}>{relatedTitles[relatedId] || relationship.title || 'Verbundene Information'}</Text>
                        <Text style={styles.itemMeta}>{formatRelationshipType(relationship.type)}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={17} color={palette.textTertiary} />
                    </Pressable>
                  );
                }) : <Text style={styles.emptyText}>Noch keine bestätigten Verbindungen vorhanden.</Text>}
              </GlassPanel>
            ) : null}

            {activeTab === 'sources' ? (
              <View style={styles.stack}>
                <GlassPanel style={styles.sectionPanel}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Quellen</Text>
                    <Text style={styles.sectionCount}>{details.sources.length}</Text>
                  </View>
                  {details.sources.length > 0 ? details.sources.map((source) => (
                    <View key={source.id} style={styles.itemRow}>
                      <View style={styles.smallIcon}>
                        <Ionicons name={source.type.includes('audio') ? 'mic' : 'document-text'} size={16} color={palette.warm} />
                      </View>
                      <View style={styles.itemCopy}>
                        <Text style={styles.itemTitle}>{source.title || formatSourceType(source.type)}</Text>
                        <Text style={styles.itemMeta}>{new Date(source.capturedAt).toLocaleString('de-DE')} · {source.isUserConfirmed ? 'Bestätigt' : 'Erfasst'}</Text>
                      </View>
                    </View>
                  )) : <Text style={styles.emptyText}>Hier sind noch keine direkten Quellen verknüpft.</Text>}
                </GlassPanel>

                {details.aliases.length > 0 ? (
                  <GlassPanel style={styles.sectionPanel}>
                    <View style={styles.sectionHeader}>
                      <Text style={styles.sectionTitle}>Weitere Namen</Text>
                      <Text style={styles.sectionCount}>{details.aliases.length}</Text>
                    </View>
                    {details.aliases.map((alias) => (
                      <View key={alias.id} style={styles.detailRow}>
                        <Text style={styles.detailLabel}>{formatAliasKind(alias.kind)}</Text>
                        <Text style={styles.detailValue}>{alias.value}</Text>
                      </View>
                    ))}
                  </GlassPanel>
                ) : null}
              </View>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  topBar: { height: 52, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  topBarMark: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(45, 44, 42, 0.76)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(217, 163, 95, 0.16)' },
  centerState: { flex: 1, paddingHorizontal: 30, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { color: palette.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  content: { paddingHorizontal: 20, paddingBottom: 45 },
  hero: { alignItems: 'center', paddingTop: 6, paddingBottom: 22 },
  title: { marginTop: 13, color: palette.text, fontSize: 28, lineHeight: 34, fontWeight: '600', letterSpacing: -0.6, textAlign: 'center' },
  type: { marginTop: 4, color: palette.textSecondary, fontSize: 12 },

  tabsPanel: { borderRadius: radii.md, marginBottom: 14 },
  tabs: { height: 48, padding: 4, flexDirection: 'row' },
  tabButton: { flex: 1 },
  activeTab: { flex: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  activeTabText: { color: palette.text, fontSize: 12, fontWeight: '600' },
  tabText: { flex: 1, color: palette.textTertiary, fontSize: 12, textAlign: 'center', textAlignVertical: 'center' },
  stack: { gap: 12 },
  sectionPanel: { borderRadius: radii.lg, padding: 15 },
  sectionHeader: { marginBottom: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: palette.text, fontSize: 15, fontWeight: '600' },
  sectionCount: { color: palette.textTertiary, fontSize: 10 },
  detailRow: { minHeight: 43, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border, gap: 18 },
  detailLabel: { width: 92, color: palette.textTertiary, fontSize: 12 },
  detailValue: { flex: 1, color: palette.text, fontSize: 12, lineHeight: 18, textAlign: 'right' },
  descriptionBox: { marginTop: 12, padding: 13, borderRadius: radii.md, backgroundColor: palette.surfaceSoft },
  description: { color: palette.textSecondary, fontSize: 12, lineHeight: 18 },
  itemRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  smallIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceSoft },
  itemCopy: { flex: 1 },
  itemTitle: { color: palette.text, fontSize: 12, fontWeight: '500' },
  itemMeta: { marginTop: 3, color: palette.textTertiary, fontSize: 10 },
  emptyText: { paddingVertical: 20, color: palette.textTertiary, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  pressed: { opacity: 0.7 },
});
