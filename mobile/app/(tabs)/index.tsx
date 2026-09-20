import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { AppBackground } from '@/components/design/AppBackground';
import { EntityGlyph } from '@/components/design/EntityGlyph';
import { GlassPanel } from '@/components/design/GlassPanel';
import { Text } from '@/components/ui/Text';
import { VoiceCaptureCard } from '@/components/voice/VoiceCaptureCard';
import type { VoicePhase } from '@/components/voice/VoiceCaptureCard';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useApplicationServices } from '@/providers/ApplicationProvider';
import { palette, radii } from '@/theme/design';
import type { EntityRecord } from '@/domain';

interface FeedbackMessage {
  text: string;
  tone: 'success' | 'error';
}

const EXAMPLE_PROMPTS = [
  '„Merk dir das für meinen Kühlschrank.“',
  '„Was weißt du noch über meinen TÜV?“',
  '„Digitalisiere diese Rechnung.“',
  '„Ich habe heute mit Thomas gesprochen.“',
] as const;

function isVisibleKnowledge(entity: EntityRecord): boolean {
  const status = entity.status?.toUpperCase();
  return status !== 'AI_REJECTED' && status !== 'REJECTED';
}

export default function HomeScreen() {
  const router = useRouter();
  const services = useApplicationServices();
  const reduceMotion = useReduceMotion();
  const [captureText, setCaptureText] = useState('');
  const [recent, setRecent] = useState<EntityRecord[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<FeedbackMessage | null>(null);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  const [promptIndex, setPromptIndex] = useState(0);

  const refreshHome = useCallback(async () => {
    try {
      const [reviews, entities] = await Promise.all([
        services.listPendingReviews(),
        services.listRecent(8),
      ]);
      setPendingCount(
        reviews.reduce(
          (count, review) => count + review.proposals.filter((proposal) => proposal.status === 'PENDING').length,
          0,
        ),
      );
      setRecent(entities.filter(isVisibleKnowledge));
    } catch {
      setMessage({ text: 'Dein Wissen konnte gerade nicht vollständig geladen werden.', tone: 'error' });
    } finally {
      setIsLoading(false);
    }
  }, [services]);

  useFocusEffect(
    useCallback(() => {
      void refreshHome();
    }, [refreshHome]),
  );

  useEffect(() => {
    if (voicePhase !== 'idle' || reduceMotion) return undefined;
    const interval = setInterval(() => {
      setPromptIndex((current) => (current + 1) % EXAMPLE_PROMPTS.length);
    }, 5200);
    return () => clearInterval(interval);
  }, [reduceMotion, voicePhase]);

  const submitText = async () => {
    const text = captureText.trim();
    if (!text || isSubmitting) return;
    setIsSubmitting(true);
    setMessage(null);
    try {
      const result = await services.ingestNaturalLanguage({ text });
      setCaptureText('');
      if (result.interpretationStatus === 'local_capture_only') {
        setMessage({ text: 'Privat gespeichert. Ich kann später noch einmal versuchen, es einzuordnen.', tone: 'success' });
      } else if (result.interpretationStatus === 'partially_applied') {
        setMessage({ text: 'Gespeichert. Einige Zusammenhänge schaue ich mir später noch einmal an.', tone: 'success' });
      } else {
        setMessage({ text: 'Verstanden und gespeichert. Du kannst meine Vorschläge gleich prüfen.', tone: 'success' });
      }
      await refreshHome();
    } catch {
      setMessage({ text: 'Die Information konnte gerade nicht gespeichert werden. Bitte versuche es erneut.', tone: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppBackground>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brandBlock}>
            <Text style={styles.brand}>Appifex</Text>
            <Text style={styles.headline}>Was möchtest du heute festhalten?</Text>
            <Text style={styles.tagline}>Erzähl es einfach. Ich kümmere mich um den Rest.</Text>
          </View>

          <VoiceCaptureCard
            services={services}
            disabled={isSubmitting}
            onMessage={setMessage}
            onCompleted={refreshHome}
            onPhaseChange={setVoicePhase}
          />

          {message ? (
            <View
              accessibilityLiveRegion="polite"
              style={[styles.message, message.tone === 'error' && styles.messageError]}
            >
              <Ionicons
                name={message.tone === 'error' ? 'alert-circle' : 'checkmark-circle'}
                size={17}
                color={message.tone === 'error' ? palette.danger : palette.success}
              />
              <Text style={styles.messageText}>{message.text}</Text>
            </View>
          ) : null}

          <Text style={styles.writeLabel}>Oder lieber schreiben?</Text>

          <GlassPanel animatedHighlight style={styles.textComposer}>
            <View style={styles.composerContent}>
              <TextInput
                value={captureText}
                onChangeText={setCaptureText}
                placeholder="Was möchtest du festhalten?"
                placeholderTextColor={palette.textTertiary}
                multiline
                maxLength={4000}
                accessibilityLabel="Information als Text eingeben"
                style={styles.input}
              />
              <Pressable
                onPress={() => void submitText()}
                disabled={!captureText.trim() || isSubmitting}
                accessibilityRole="button"
                accessibilityLabel="Information speichern"
                style={({ pressed }) => [
                  styles.sendButton,
                  (!captureText.trim() || isSubmitting) && styles.sendButtonDisabled,
                  pressed && styles.pressed,
                ]}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color={palette.text} />
                ) : (
                  <Ionicons name="arrow-up" size={20} color={palette.text} />
                )}
              </Pressable>
            </View>
          </GlassPanel>

          <View style={styles.exampleRow}>
            <Text numberOfLines={2} style={styles.exampleText}>Zum Beispiel: {EXAMPLE_PROMPTS[promptIndex]}</Text>
          </View>

          {pendingCount > 0 ? (
            <Pressable
              onPress={() => router.push('/review')}
              accessibilityRole="button"
              accessibilityLabel={`${pendingCount} Vorschläge prüfen`}
              style={({ pressed }) => [styles.reviewPressable, pressed && styles.pressed]}
            >
              <View style={styles.reviewCard}>
                <Ionicons name="sparkles-outline" size={17} color={palette.warm} />
                <View style={styles.reviewCopy}>
                  <Text style={styles.reviewTitle}>{pendingCount === 1 ? '1 Vorschlag prüfen' : `${pendingCount} Vorschläge prüfen`}</Text>
                  <Text style={styles.reviewSubtitle}>Schau kurz nach, ob alles stimmt.</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={palette.textSecondary} />
              </View>
            </Pressable>
          ) : null}

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Für dich gemerkt</Text>
            <Pressable onPress={() => router.push('/(tabs)/knowledge')} hitSlop={12}>
              <Text style={styles.link}>Mehr</Text>
            </Pressable>
          </View>

          {isLoading ? (
            <ActivityIndicator color={palette.blue} style={styles.loader} />
          ) : recent.length > 0 ? (
            <View style={styles.recentPanel}>
              {recent.slice(0, 2).map((entity, index) => (
                <Pressable
                  key={entity.id}
                  onPress={() => router.push({ pathname: '/entity/[id]', params: { id: entity.id } })}
                  style={({ pressed }) => [styles.recentRow, index > 0 && styles.recentDivider, pressed && styles.rowPressed]}
                >
                  <EntityGlyph type={entity.type} size={38} accent={index === 1 ? 'violet' : 'blue'} />
                  <View style={styles.recentCopy}>
                    <Text numberOfLines={2} style={styles.recentTitle}>{entity.title}</Text>
                    <Text style={styles.recentMeta}>Für dich gespeichert</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={17} color={palette.textTertiary} />
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>Erzähl mir etwas – den Rest übernehme ich.</Text>
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
    paddingTop: 14,
    paddingBottom: 126,
  },
  brandBlock: {
    alignItems: 'center',
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  brand: {
    color: palette.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  headline: {
    maxWidth: 334,
    marginTop: 10,
    color: palette.text,
    fontSize: 27,
    lineHeight: 33,
    fontWeight: '500',
    textAlign: 'center',
    letterSpacing: -0.8,
  },
  tagline: {
    maxWidth: 310,
    marginTop: 6,
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  message: {
    marginTop: 13,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: 'rgba(70, 199, 145, 0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(113, 230, 177, 0.22)',
  },
  messageError: {
    backgroundColor: 'rgba(255, 113, 133, 0.08)',
    borderColor: 'rgba(255, 113, 133, 0.22)',
  },
  messageText: {
    flex: 1,
    color: palette.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  writeLabel: {
    marginTop: 18,
    marginBottom: 8,
    color: palette.textSecondary,
    fontSize: 12,
    textAlign: 'center',
  },
  textComposer: {
    borderRadius: radii.pill,
  },
  composerContent: {
    minHeight: 55,
    paddingLeft: 18,
    paddingRight: 6,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  input: {
    flex: 1,
    maxHeight: 96,
    color: palette.text,
    fontSize: 14,
    lineHeight: 19,
    paddingVertical: 8,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.blueStrong,
    boxShadow: '0 5px 18px rgba(52, 120, 246, 0.28)',
  },
  sendButtonDisabled: {
    opacity: 0.3,
  },
  exampleRow: {
    minHeight: 34,
    paddingHorizontal: 13,
    paddingTop: 9,
    alignItems: 'center',
  },
  exampleText: {
    maxWidth: 310,
    color: palette.textTertiary,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  reviewPressable: {
    marginTop: 10,
    borderRadius: radii.md,
  },
  reviewCard: {
    minHeight: 62,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  reviewCopy: {
    flex: 1,
  },
  reviewTitle: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '600',
  },
  reviewSubtitle: {
    marginTop: 3,
    color: palette.textSecondary,
    fontSize: 11,
    lineHeight: 15,
  },
  sectionHeader: {
    marginTop: 27,
    marginBottom: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: palette.text,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  link: {
    color: palette.blue,
    fontSize: 12,
    fontWeight: '500',
  },
  loader: {
    marginVertical: 28,
  },
  recentPanel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
  },
  recentRow: {
    minHeight: 66,
    paddingHorizontal: 2,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  recentDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
  },
  recentCopy: {
    flex: 1,
  },
  recentTitle: {
    color: palette.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '500',
  },
  recentMeta: {
    marginTop: 3,
    color: palette.textTertiary,
    fontSize: 10,
  },
  rowPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  emptyText: {
    color: palette.textTertiary,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    paddingVertical: 22,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.985 }],
  },
});
