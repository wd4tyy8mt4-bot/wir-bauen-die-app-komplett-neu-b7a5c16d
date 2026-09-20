import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { AppBackground } from '@/components/design/AppBackground';
import { EntityGlyph } from '@/components/design/EntityGlyph';
import { GlassPanel } from '@/components/design/GlassPanel';
import { palette, radii } from '@/theme/design';
import type {
  AIActionProposal,
  AIProposalKind,
  AIProposalReview,
  JsonObject,
  PersistedAIActionProposal,
} from '@/domain';
import { useApplicationServices } from '@/providers/ApplicationProvider';

const KIND_LABELS: Record<AIProposalKind, string> = {
  entity: 'Person, Ort oder Sache',
  attribute: 'Neue Angabe',
  relationship: 'Verbindung',
  event: 'Erlebnis oder Termin',
  memory: 'Erinnerung',
  alias: 'Weitere Bezeichnung',
};

interface RevisionGroup {
  current: PersistedAIActionProposal;
  superseded?: PersistedAIActionProposal;
  replacedValue?: string;
  isRevision: boolean;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function proposalMetadata(proposal: AIActionProposal): JsonObject | undefined {
  return isJsonObject(proposal.payload.metadata) ? proposal.payload.metadata : undefined;
}

function displayValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
  if (isJsonObject(value) && typeof value.amount === 'string' && typeof value.currency === 'string') {
    return `${value.amount} ${value.currency}`;
  }
  return undefined;
}

function proposalValue(proposal: AIActionProposal): string {
  const { payload } = proposal;
  if (typeof payload.title === 'string') return payload.title;
  if (typeof payload.content === 'string') return payload.content;
  return displayValue(payload.value) ?? 'Weitere Information';
}

function proposalLocalId(proposal: AIActionProposal): string {
  return proposal.proposal_id.startsWith('proposal_')
    ? proposal.proposal_id.slice('proposal_'.length)
    : proposal.proposal_id;
}

function groupPendingProposals(proposals: PersistedAIActionProposal[]): RevisionGroup[] {
  const pending = proposals.filter((item) => item.status === 'PENDING');
  const hiddenIds = new Set<string>();
  const groups = pending.map((current) => {
    const metadata = proposalMetadata(current.proposal);
    const isRevision = metadata?.revision_status === 'current_claim';
    const previousLocalId = isRevision && typeof metadata.revises_local_id === 'string'
      ? metadata.revises_local_id
      : undefined;
    const superseded = previousLocalId
      ? proposals.find((candidate) => candidate.id !== current.id && proposalLocalId(candidate.proposal) === previousLocalId)
      : undefined;
    if (superseded) hiddenIds.add(superseded.id);
    return {
      current,
      superseded,
      replacedValue: displayValue(metadata?.revises_value),
      isRevision,
    };
  });
  return groups.filter(({ current }) => !hiddenIds.has(current.id));
}

function correctedWith(proposal: AIActionProposal, typeKey: string, value: string): AIActionProposal {
  const payload = { ...proposal.payload };
  if (proposal.target_kind === 'attribute' || proposal.target_kind === 'alias') {
    if (proposal.type_key === 'price' && isJsonObject(payload.value)) {
      const amount = value.trim().split(/\s+/, 1)[0] ?? value.trim();
      payload.value = { ...payload.value, amount };
    } else {
      payload.value = value;
    }
  } else if (proposal.target_kind === 'memory') {
    payload.content = value;
  } else {
    payload.title = value;
  }
  return {
    ...proposal,
    type_key: typeKey.trim() || proposal.type_key,
    payload,
  };
}

function labelForType(typeKey: string): string {
  const normalizedKey = typeKey.toLowerCase();
  if (normalizedKey === 'unknown.entity' || normalizedKey === 'unknown') return 'Allgemeine Information';
  if (normalizedKey === 'price') return 'Preis';
  if (normalizedKey === 'name') return 'Name';
  if (normalizedKey === 'task') return 'Aufgabe';
  return 'Weitere Angabe';
}


export default function ReviewScreen() {
  const services = useApplicationServices();
  const router = useRouter();
  const [reviews, setReviews] = useState<AIProposalReview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyProposalId, setBusyProposalId] = useState<string>();
  const [editingProposalId, setEditingProposalId] = useState<string>();
  const [editTypeKey, setEditTypeKey] = useState('');
  const [editTypeLabel, setEditTypeLabel] = useState('');
  const [editValue, setEditValue] = useState('');
  const [message, setMessage] = useState<string>();

  const loadReviews = useCallback(async () => {
    setIsLoading(true);
    try {
      setReviews(await services.listPendingReviews());
    } catch {
      setMessage('Die offenen Vorschläge konnten gerade nicht geladen werden.');
    } finally {
      setIsLoading(false);
    }
  }, [services]);

  useFocusEffect(useCallback(() => {
    void loadReviews();
  }, [loadReviews]));

  const runDecision = async (proposalId: string, action: () => Promise<unknown>, successMessage: string) => {
    if (busyProposalId) return;
    setBusyProposalId(proposalId);
    setMessage(undefined);
    try {
      await action();
      setEditingProposalId(undefined);
      setMessage(successMessage);
      await loadReviews();
    } catch {
      setMessage('Die Entscheidung konnte nicht gespeichert werden. Bitte versuche es erneut.');
    } finally {
      setBusyProposalId(undefined);
    }
  };

  const startCorrection = (proposalId: string, proposal: AIActionProposal) => {
    setEditingProposalId(proposalId);
    setEditTypeKey(proposal.type_key);
    setEditTypeLabel(labelForType(proposal.type_key));
    setEditValue(proposalValue(proposal));
  };

  const pendingTotal = reviews.reduce((count, review) => count + groupPendingProposals(review.proposals).length, 0);

  return (
    <AppBackground>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView style={styles.safeArea} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Zurück" style={styles.backButton}>
              <Ionicons name="chevron-back" size={24} color={palette.text} />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text accessibilityRole="header" style={styles.headerTitle}>Kurz prüfen</Text>
              <Text style={styles.headerSubtitle}>{pendingTotal} {pendingTotal === 1 ? 'Gedanke wartet' : 'Gedanken warten'} auf dich.</Text>
            </View>
            <View style={styles.countBubble}><Text style={styles.countText}>{pendingTotal}</Text></View>
          </View>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {message ? (
              <GlassPanel style={styles.messageBox}>
                <View style={styles.messageContent} accessibilityLiveRegion="polite">
                  <Ionicons name="information-circle" size={18} color={palette.warm} />
                  <Text style={styles.messageText}>{message}</Text>
                </View>
              </GlassPanel>
            ) : null}

            {isLoading ? (
              <View style={styles.centerState}>
                <ActivityIndicator color={palette.warm} />
                <Text style={styles.centerText}>Ich bereite alles für dich vor …</Text>
              </View>
            ) : reviews.length === 0 ? (
              <GlassPanel style={styles.emptyPanel} strong>
                <View style={styles.emptyIcon}><Ionicons name="checkmark" size={28} color={palette.success} /></View>
                <Text style={styles.emptyTitle}>Alles geprüft</Text>
                <Text style={styles.centerText}>Im Moment gibt es nichts, das du prüfen musst.</Text>
              </GlassPanel>
            ) : (
              reviews.map((review) => {
                const groups = groupPendingProposals(review.proposals);
                if (groups.length === 0) return null;
                return (
                  <GlassPanel key={review.extraction.id} style={styles.reviewPanel} strong>
                    <View style={styles.sourceBlock}>
                      <View style={styles.sourceHeader}>
                        <Ionicons name="chatbubble-ellipses-outline" size={15} color={palette.textSecondary} />
                        <Text style={styles.sourceLabel}>Du hast gesagt</Text>
                        <Text style={styles.openCount}>{groups.length} {groups.length === 1 ? 'Gedanke' : 'Gedanken'}</Text>
                      </View>
                      <Text style={styles.originalText}>„{review.originalText}“</Text>
                    </View>

                    {groups.map(({ current: item, superseded, replacedValue, isRevision }, groupIndex) => {
                      const proposal = item.proposal;
                      const label = proposalValue(proposal);
                      const isBusy = busyProposalId === item.id;
                      const isEditing = editingProposalId === item.id;
                      const supersededLabel = superseded ? proposalValue(superseded.proposal) : replacedValue;
                      const revisionLabel = proposal.type_key === 'price' ? 'Preis geändert' : `${labelForType(proposal.type_key)} geändert`;

                      return (
                        <View key={item.id} style={[styles.proposal, groupIndex > 0 && styles.proposalDivider]}>
                          <View style={styles.proposalHeader}>
                            <View style={styles.kindGroup}>
                              <EntityGlyph type={proposal.target_kind} size={38} accent={isRevision ? 'warm' : 'blue'} />
                              <View>
                                <Text style={styles.kindLabel}>{isRevision ? revisionLabel : 'Ich habe daraus Folgendes verstanden'}</Text>
                                <Text style={styles.kindMeta}>{KIND_LABELS[proposal.target_kind]} · {labelForType(proposal.type_key)}</Text>
                              </View>
                            </View>

                          </View>

                          {isRevision ? (
                            <View style={styles.revisionComparison}>
                              <View style={styles.revisionColumn}>
                                <Text style={styles.oldLabel}>Vorher</Text>
                                <Text style={styles.oldValue}>{supersededLabel ?? 'Bisherige Angabe'}</Text>
                              </View>
                              <View style={styles.revisionArrow}>
                                <Ionicons name="arrow-forward" size={15} color={palette.warm} />
                              </View>
                              <View style={styles.revisionColumn}>
                                <Text style={styles.newLabel}>Neu</Text>
                                <Text style={styles.newValue}>{label}</Text>
                              </View>
                            </View>
                          ) : (
                            <View style={styles.valueBlock}>
                              <Text style={styles.value}>{label}</Text>
                              <Text style={styles.valueType}>{labelForType(proposal.type_key)}</Text>
                            </View>
                          )}

                          {proposal.provenance.evidence_text ? (
                            <View style={styles.evidenceBox}>
                              <Text style={styles.evidenceLabel}>Aus deiner Nachricht</Text>
                              <Text style={styles.evidenceText}>„{proposal.provenance.evidence_text}“</Text>
                            </View>
                          ) : null}

                          {isEditing ? (
                            <View style={styles.correctionBox}>
                              <Text style={styles.inputLabel}>Worum geht es?</Text>
                              <TextInput
                                value={editTypeLabel}
                                onChangeText={(value) => {
                                  setEditTypeLabel(value);
                                  if (value.trim()) {
                                    setEditTypeKey(value.trim().toLocaleLowerCase('de-DE').replace(/\s+/g, '.'));
                                  }
                                }}
                                placeholder="z. B. Person, Ort oder Preis"
                                placeholderTextColor={palette.textTertiary}
                                autoCapitalize="sentences"
                                accessibilityLabel="Art der Information ändern"
                                style={styles.input}
                              />
                              <Text style={styles.inputLabel}>Was soll stattdessen dort stehen?</Text>
                              <TextInput
                                value={editValue}
                                onChangeText={setEditValue}
                                placeholder="Richtige Angabe"
                                placeholderTextColor={palette.textTertiary}
                                multiline={proposal.target_kind === 'memory'}
                                textAlignVertical="top"
                                accessibilityLabel="Wert des Vorschlags korrigieren"
                                style={[styles.input, proposal.target_kind === 'memory' && styles.multilineInput]}
                              />
                              <Pressable
                                onPress={() => void runDecision(
                                  item.id,
                                  () => services.correctProposal(item.id, { proposal: correctedWith(proposal, editTypeKey, editValue) }),
                                  'Deine Änderung wurde übernommen.',
                                )}
                                disabled={Boolean(busyProposalId) || !editValue.trim()}
                                accessibilityRole="button"
                                accessibilityLabel={`Korrektur für ${label} speichern`}
                                style={({ pressed }) => [styles.primaryButton, (!editValue.trim() || Boolean(busyProposalId)) && styles.disabled, pressed && styles.pressed]}
                              >
                                <LinearGradient colors={['rgba(217, 163, 95, 0.34)', 'rgba(126, 101, 75, 0.24)']} style={styles.primaryGradient}>
                                  {isBusy ? <ActivityIndicator color={palette.text} /> : <Text style={styles.primaryText}>Änderung übernehmen</Text>}
                                </LinearGradient>
                              </Pressable>
                              <Pressable onPress={() => setEditingProposalId(undefined)} disabled={Boolean(busyProposalId)} style={styles.cancelEdit}>
                                <Text style={styles.cancelEditText}>Abbrechen</Text>
                              </Pressable>
                            </View>
                          ) : (
                            <View style={styles.actions}>
                              <Pressable
                                onPress={() => void runDecision(item.id, () => services.confirmProposal(item.id), 'Übernommen und für dich gespeichert.')}
                                disabled={Boolean(busyProposalId)}
                                accessibilityRole="button"
                                accessibilityLabel={`${label} übernehmen`}
                                style={({ pressed }) => [styles.actionButton, styles.confirmButton, pressed && styles.pressed]}
                              >
                                {isBusy ? <ActivityIndicator size="small" color={palette.text} /> : <Ionicons name="checkmark" size={18} color={palette.text} />}
                                <Text style={styles.actionText}>Übernehmen</Text>
                              </Pressable>
                              <Pressable
                                onPress={() => startCorrection(item.id, proposal)}
                                disabled={Boolean(busyProposalId)}
                                accessibilityRole="button"
                                accessibilityLabel={`${label} ändern`}
                                style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
                              >
                                <Ionicons name="pencil" size={16} color={palette.textSecondary} />
                                <Text style={styles.secondaryActionText}>Ändern</Text>
                              </Pressable>
                              <Pressable
                                onPress={() => void runDecision(item.id, () => services.rejectProposal(item.id), 'Der Vorschlag wurde verworfen.')}
                                disabled={Boolean(busyProposalId)}
                                accessibilityRole="button"
                                accessibilityLabel={`Vorschlag ${label} verwerfen`}
                                style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
                              >
                                <Ionicons name="close" size={18} color={palette.textSecondary} />
                                <Text style={styles.secondaryActionText}>Verwerfen</Text>
                              </Pressable>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </GlassPanel>
                );
              })
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  topBar: { minHeight: 70, paddingHorizontal: 16, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 10 },
  backButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(244, 226, 202, 0.11)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244, 226, 202, 0.22)' },
  headerCopy: { flex: 1 },
  headerTitle: { color: palette.text, fontSize: 21, fontWeight: '600', letterSpacing: -0.4 },
  headerSubtitle: { marginTop: 3, color: palette.textTertiary, fontSize: 10 },
  countBubble: { minWidth: 28, height: 28, paddingHorizontal: 8, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(217, 163, 95, 0.10)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(217, 163, 95, 0.24)' },
  countText: { color: palette.text, fontSize: 11, fontWeight: '600' },
  content: { paddingHorizontal: 16, paddingBottom: 40, gap: 14 },
  messageBox: { borderRadius: radii.md },
  messageContent: { padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  messageText: { flex: 1, color: palette.textSecondary, fontSize: 12, lineHeight: 18 },
  centerState: { minHeight: 260, alignItems: 'center', justifyContent: 'center', gap: 12 },
  centerText: { maxWidth: 270, color: palette.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  emptyPanel: { minHeight: 300, borderRadius: radii.xl, alignItems: 'center', justifyContent: 'center', padding: 28 },
  emptyIcon: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(113, 230, 177, 0.10)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(113, 230, 177, 0.28)' },
  emptyTitle: { marginTop: 16, marginBottom: 6, color: palette.text, fontSize: 20, fontWeight: '600' },
  reviewPanel: { borderRadius: radii.xl },
  sourceBlock: { padding: 17, backgroundColor: 'rgba(244, 226, 202, 0.07)' },
  sourceHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sourceLabel: { color: palette.textSecondary, fontSize: 10, fontWeight: '600' },
  openCount: { marginLeft: 'auto', color: palette.textTertiary, fontSize: 9 },
  originalText: { marginTop: 10, color: palette.text, fontSize: 13, lineHeight: 19, fontStyle: 'italic' },
  proposal: { paddingHorizontal: 17, paddingVertical: 18 },
  proposalDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border },
  proposalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  kindGroup: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  kindLabel: { color: palette.text, fontSize: 13, fontWeight: '600' },
  kindMeta: { marginTop: 3, color: palette.textTertiary, fontSize: 9 },

  revisionComparison: { marginTop: 16, padding: 14, borderRadius: radii.md, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(244, 226, 202, 0.09)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244, 226, 202, 0.20)' },
  revisionColumn: { flex: 1 },
  newLabel: { color: palette.warm, fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
  newValue: { marginTop: 5, color: palette.text, fontSize: 18, fontWeight: '600' },
  revisionArrow: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(244, 226, 202, 0.12)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244, 226, 202, 0.22)' },
  oldLabel: { color: palette.textTertiary, fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7 },
  oldValue: { marginTop: 5, color: palette.textSecondary, fontSize: 15, fontWeight: '500', textDecorationLine: 'line-through' },
  valueBlock: { marginTop: 15 },
  value: { color: palette.text, fontSize: 19, lineHeight: 25, fontWeight: '600' },
  valueType: { marginTop: 4, color: palette.textTertiary, fontSize: 10 },
  evidenceBox: { marginTop: 14, padding: 13, borderRadius: radii.md, backgroundColor: 'rgba(244, 226, 202, 0.09)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244, 226, 202, 0.20)' },
  evidenceLabel: { color: palette.textTertiary, fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  evidenceText: { marginTop: 5, color: palette.textSecondary, fontSize: 11, lineHeight: 17 },
  actions: { marginTop: 16, flexDirection: 'row', gap: 7 },
  actionButton: { minHeight: 45, flex: 1, paddingHorizontal: 7, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: 'rgba(244, 226, 202, 0.10)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244, 226, 202, 0.24)' },
  confirmButton: { backgroundColor: 'rgba(217, 163, 95, 0.20)', borderColor: 'rgba(231, 184, 124, 0.42)' },
  actionText: { color: palette.text, fontSize: 10, fontWeight: '600' },
  secondaryActionText: { color: palette.textSecondary, fontSize: 10, fontWeight: '500' },
  correctionBox: { marginTop: 15, padding: 14, borderRadius: radii.md, backgroundColor: 'rgba(244, 226, 202, 0.09)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244, 226, 202, 0.22)' },
  inputLabel: { marginBottom: 7, color: palette.textSecondary, fontSize: 10, fontWeight: '600' },
  input: { minHeight: 48, marginBottom: 13, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, color: palette.text, fontSize: 13, backgroundColor: 'rgba(244, 226, 202, 0.10)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(244, 226, 202, 0.30)' },
  multilineInput: { minHeight: 92 },
  primaryButton: { minHeight: 48, borderRadius: 15, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(231, 184, 124, 0.48)' },
  primaryGradient: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: palette.text, fontSize: 12, fontWeight: '600' },
  cancelEdit: { minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  cancelEditText: { color: palette.textSecondary, fontSize: 12 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.74, transform: [{ scale: 0.98 }] },
});
