import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';

import { AmbientOrb } from '@/components/design/AmbientOrb';
import type { AmbientOrbState } from '@/components/design/AmbientOrb';
import { GlassPanel } from '@/components/design/GlassPanel';
import { Text } from '@/components/ui/Text';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { palette, radii } from '@/theme/design';
import type { ApplicationServices } from '@/application/services';
import type { TranscriptionResponse } from '@/domain';

const MAX_RECORDING_MS = 5 * 60 * 1000;
const MIN_RECORDING_MS = 700;
const READY_GLOW_MS = 1400;
const WAVE_HEIGHTS = [8, 16, 10, 24, 15, 31, 19, 37, 24, 14, 29, 18, 33, 12, 22, 10, 16, 7];

export type VoicePhase = 'idle' | 'recording' | 'saving' | 'transcribing' | 'processing';

interface VoiceCaptureCardProps {
  services: ApplicationServices;
  disabled?: boolean;
  onCompleted: () => Promise<void>;
  onMessage: (message: { text: string; tone: 'success' | 'error' }) => void;
  onPhaseChange?: (phase: VoicePhase) => void;
}

function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

async function preserveRecording(uri: string): Promise<{ uri: string; durable: boolean }> {
  if (!FileSystem.documentDirectory) {
    return { uri, durable: false };
  }
  const directory = `${FileSystem.documentDirectory}voice-captures/`;
  const destination = `${directory}voice-${Date.now()}.m4a`;
  try {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    await FileSystem.copyAsync({ from: uri, to: destination });
    return { uri: destination, durable: true };
  } catch {
    return { uri, durable: false };
  }
}

function statusText(phase: VoicePhase): string {
  if (phase === 'recording') return 'Ich höre dir zu';
  if (phase === 'saving') return 'Einen Moment …';
  if (phase === 'transcribing') return 'Ich höre noch einmal hin …';
  if (phase === 'processing') return 'Ich verbinde, was du erzählt hast …';
  return 'Zum Sprechen tippen';
}

function orbStateForPhase(phase: VoicePhase, isReady: boolean): AmbientOrbState {
  if (isReady && phase === 'idle') return 'ready';
  if (phase === 'recording') return 'listening';
  if (phase === 'saving' || phase === 'transcribing' || phase === 'processing') return 'processing';
  return 'idle';
}

export function VoiceCaptureCard({
  services,
  disabled = false,
  onCompleted,
  onMessage,
  onPhaseChange,
}: VoiceCaptureCardProps) {
  const reduceMotion = useReduceMotion();
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const recorderState = useAudioRecorderState(recorder, 200);
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const stoppingRef = useRef(false);
  const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waveformEnergy = useRef(new Animated.Value(0)).current;
  const processingPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    onPhaseChange?.(phase);
  }, [onPhaseChange, phase]);

  useEffect(() => () => {
    if (readyTimeoutRef.current) {
      clearTimeout(readyTimeoutRef.current);
    }
  }, []);

  const showReadyGlow = () => {
    if (readyTimeoutRef.current) {
      clearTimeout(readyTimeoutRef.current);
    }
    setIsReady(true);
    readyTimeoutRef.current = setTimeout(() => {
      setIsReady(false);
      readyTimeoutRef.current = null;
    }, READY_GLOW_MS);
  };

  const finishRecording = async () => {
    if (phase !== 'recording' || stoppingRef.current) return;
    stoppingRef.current = true;
    const durationMs = recorderState.durationMillis;
    setPhase('saving');

    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const temporaryUri = recorder.uri;
      if (!temporaryUri) {
        throw new Error('missing_recording_uri');
      }

      const preserved = await preserveRecording(temporaryUri);
      let transcription: TranscriptionResponse;
      if (durationMs < MIN_RECORDING_MS) {
        transcription = {
          status: 'empty',
          provider: services.extensions.transcription?.key ?? 'none',
          errorCode: 'recording_too_short',
        };
      } else if (!services.extensions.transcription) {
        transcription = {
          status: 'unavailable',
          provider: 'none',
          errorCode: 'transcription_provider_unavailable',
        };
      } else {
        setPhase('transcribing');
        transcription = await services.extensions.transcription.transcribe({
          audioUri: preserved.uri,
          locale: 'de-DE',
          durationMs,
        });
      }

      const capturedAt = new Date().toISOString();
      const audio = await services.captureVoiceAudio({
        uri: preserved.uri,
        capturedAt,
        durationMs,
        mimeType: 'audio/m4a',
        transcriptionStatus: transcription.status,
        transcriptionProvider: transcription.provider,
        transcript: transcription.transcript,
        errorCode: transcription.errorCode,
        privacyClassification: 'PRIVATE',
        metadata: {
          storageState: preserved.durable ? 'durable' : 'temporary',
          maximumRecordingMs: MAX_RECORDING_MS,
        },
      });

      const transcript = transcription.transcript?.trim();
      if (transcription.status === 'completed' && transcript) {
        setLastTranscript(transcript);
        setPhase('processing');
        await services.ingestNaturalLanguage({
          text: transcript,
          capturedAt,
          voiceSourceId: audio.source.id,
          transcription,
        });
        onMessage({
          text: 'Verstanden. Ich habe es privat gespeichert und für deine Prüfung vorbereitet.',
          tone: 'success',
        });
        await onCompleted();
        showReadyGlow();
      } else if (transcription.status === 'empty') {
        onMessage({
          text: 'Die Aufnahme wurde privat gespeichert, aber ich konnte keine Sprache erkennen.',
          tone: 'error',
        });
      } else if (transcription.status === 'unavailable') {
        onMessage({
          text: 'Die Aufnahme ist privat gespeichert. Auf diesem Gerät konnte ich sie gerade nicht verstehen.',
          tone: 'error',
        });
      } else {
        onMessage({
          text: 'Die Aufnahme ist privat gespeichert. Ich konnte sie gerade nicht vollständig verstehen.',
          tone: 'error',
        });
      }
    } catch {
      onMessage({
        text: 'Die Aufnahme konnte nicht vollständig verarbeitet werden. Vorhandene Audiodaten bleiben nach Möglichkeit auf dem Gerät.',
        tone: 'error',
      });
    } finally {
      stoppingRef.current = false;
      setPhase('idle');
    }
  };

  useEffect(() => {
    if (phase === 'recording' && recorderState.durationMillis >= MAX_RECORDING_MS) {
      void finishRecording();
    }
  });

  const startRecording = async () => {
    if (disabled || phase !== 'idle') return;
    setIsReady(false);
    onMessage({ text: 'Mikrofon wird vorbereitet …', tone: 'success' });
    try {
      const currentPermission = await AudioModule.getRecordingPermissionsAsync();
      const permission = currentPermission.granted
        ? currentPermission
        : await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        onMessage({
          text: 'Mikrofonzugriff wurde nicht erlaubt. Du kannst ihn in den iPhone-Einstellungen aktivieren.',
          tone: 'error',
        });
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setLastTranscript(null);
      setPhase('recording');
    } catch {
      setPhase('idle');
      onMessage({
        text: 'Die Aufnahme konnte nicht gestartet werden. Bitte versuche es erneut.',
        tone: 'error',
      });
    }
  };

  const cancelRecording = async () => {
    if (phase !== 'recording' || stoppingRef.current) return;
    stoppingRef.current = true;
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (uri) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      }
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      onMessage({ text: 'Aufnahme abgebrochen.', tone: 'success' });
    } catch {
      onMessage({ text: 'Die Aufnahme wurde beendet.', tone: 'success' });
    } finally {
      stoppingRef.current = false;
      setPhase('idle');
    }
  };

  const isBusy = phase !== 'idle' && phase !== 'recording';
  const orbState = orbStateForPhase(phase, isReady);

  useEffect(() => {
    waveformEnergy.stopAnimation();
    processingPulse.stopAnimation();

    if (reduceMotion) {
      waveformEnergy.setValue(0.46);
      processingPulse.setValue(isBusy ? 0.52 : 0);
      return undefined;
    }

    waveformEnergy.setValue(0);
    processingPulse.setValue(0);

    let animation: Animated.CompositeAnimation | undefined;
    if (phase === 'recording') {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(waveformEnergy, { toValue: 0.72, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(waveformEnergy, { toValue: 0.22, duration: 340, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(waveformEnergy, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(waveformEnergy, { toValue: 0.38, duration: 300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(waveformEnergy, { toValue: 0.64, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(waveformEnergy, { toValue: 0, duration: 520, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      );
    } else if (isBusy) {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(processingPulse, { toValue: 1, duration: 760, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(processingPulse, { toValue: 0, duration: 760, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      );
    }

    animation?.start();
    return () => animation?.stop();
  }, [isBusy, phase, processingPulse, reduceMotion, waveformEnergy]);

  return (
    <GlassPanel
      animatedHighlight
      style={[styles.card, phase === 'recording' && styles.recordingCard]}
      strong
    >
      <View style={styles.cardContent}>
        <View style={styles.captureStage}>
          <View style={styles.orbWrap}>
            <AmbientOrb
              state={orbState}
              audioLevel={
                phase === 'recording' && typeof recorderState.metering === 'number'
                  ? Math.max(0, Math.min(1, (recorderState.metering + 60) / 60))
                  : undefined
              }
            />
          </View>
          <View style={[styles.energyBridge, phase === 'recording' && styles.energyBridgeActive]} />
          <Pressable
            onPress={() => void (phase === 'recording' ? finishRecording() : startRecording())}
            disabled={disabled || isBusy}
            accessibilityRole="button"
            accessibilityLabel={phase === 'recording' ? 'Sprachaufnahme stoppen' : 'Sprachaufnahme starten'}
            style={({ pressed }) => [
              styles.micButton,
              phase === 'recording' && styles.stopButton,
              (disabled || isBusy) && styles.disabledButton,
              pressed && styles.pressedButton,
            ]}
          >
            <LinearGradient
              colors={phase === 'recording' ? ['#FF8091', '#D93B63'] : ['rgba(91,190,255,0.96)', '#557DFF', '#8D6CFF']}
              style={styles.buttonGradient}
            >
              {isBusy ? (
                <ActivityIndicator color={palette.text} />
              ) : (
                <Ionicons name={phase === 'recording' ? 'stop' : 'mic'} size={31} color={palette.text} />
              )}
            </LinearGradient>
          </Pressable>
        </View>

        <Text accessibilityLiveRegion="polite" style={styles.status}>{statusText(phase)}</Text>
        <Text style={styles.helper}>
          {phase === 'recording'
            ? 'Sprich einfach weiter. Du kannst jederzeit stoppen oder abbrechen.'
            : isBusy
              ? 'Du musst nichts sortieren. Ich kümmere mich darum.'
              : 'Erzähl einfach frei. Ich merke mir, was für dich wichtig ist.'}
        </Text>

        {phase === 'recording' ? (
          <>
            <View style={styles.waveform} accessibilityElementsHidden>
              {WAVE_HEIGHTS.map((height, index) => {
                const phaseOffset = (index % 5) * 0.08;
                const lowScale = 0.52 + phaseOffset;
                const highScale = Math.min(1.22, 0.9 + (index % 4) * 0.09);

                return (
                  <Animated.View
                    key={`${height}-${index}`}
                    style={[
                      styles.waveBar,
                      {
                        height,
                        opacity: waveformEnergy.interpolate({
                          inputRange: [0, 0.5, 1],
                          outputRange: [0.44 + phaseOffset, 0.78, Math.min(1, 0.86 + phaseOffset)],
                        }),
                        transform: [{
                          scaleY: waveformEnergy.interpolate({
                            inputRange: [0, 0.5, 1],
                            outputRange: [lowScale, highScale, 0.68 + phaseOffset],
                          }),
                        }],
                      },
                    ]}
                  />
                );
              })}
            </View>
            <Text style={styles.timer}>{formatDuration(recorderState.durationMillis)}</Text>
            <View style={styles.recordingActions}>
              <Pressable
                onPress={() => void cancelRecording()}
                accessibilityRole="button"
                accessibilityLabel="Sprachaufnahme abbrechen"
                style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressedButton]}
              >
                <Ionicons name="close" size={20} color={palette.textSecondary} />
                <Text style={styles.secondaryActionText}>Abbrechen</Text>
              </Pressable>
              <Pressable
                onPress={() => void finishRecording()}
                accessibilityRole="button"
                accessibilityLabel="Sprachaufnahme stoppen"
                style={({ pressed }) => [styles.stopAction, pressed && styles.pressedButton]}
              >
                <View style={styles.stopSquare} />
                <Text style={styles.stopActionText}>Fertig</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {isBusy ? (
          <View style={styles.thinkingRow}>
            <Animated.View
              style={[
                styles.thinkingDot,
                {
                  opacity: processingPulse.interpolate({ inputRange: [0, 1], outputRange: [0.48, 1] }),
                  transform: [{
                    scale: processingPulse.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1.18] }),
                  }],
                },
              ]}
            />
            <Text style={styles.thinkingText}>Ich ordne das für dich ein</Text>
          </View>
        ) : null}

        {lastTranscript ? (
          <View style={styles.transcriptBox}>
            <View style={styles.transcriptHeader}>
              <Ionicons name="chatbubble-ellipses" size={15} color={palette.blue} />
              <Text style={styles.transcriptLabel}>Das habe ich verstanden</Text>
            </View>
            <Text numberOfLines={3} style={styles.transcriptText}>{lastTranscript}</Text>
          </View>
        ) : null}

        {phase === 'idle' && !lastTranscript ? (
          <View style={styles.privacyRow}>
            <Ionicons name="lock-closed" size={12} color={palette.textTertiary} />
            <Text style={styles.privacyText}>Privat auf deinem Gerät</Text>
          </View>
        ) : null}
      </View>
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderRadius: 34,
  },
  recordingCard: {
    borderColor: 'rgba(231, 176, 87, 0.3)',
  },
  cardContent: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 18,
  },
  captureStage: {
    width: 238,
    height: 238,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'visible',
  },
  orbWrap: {
    position: 'absolute',
    top: -24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  energyBridge: {
    position: 'absolute',
    bottom: 43,
    width: 3,
    height: 52,
    borderRadius: 999,
    backgroundColor: 'rgba(111, 179, 222, 0.3)',
    boxShadow: '0 0 22px rgba(81, 157, 211, 0.34)',
  },
  energyBridgeActive: {
    backgroundColor: 'rgba(238, 183, 92, 0.5)',
    boxShadow: '0 0 24px rgba(233, 167, 70, 0.38)',
  },
  micButton: {
    width: 72,
    height: 72,
    marginBottom: 4,
    borderRadius: 36,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(235, 246, 255, 0.62)',
    boxShadow: '0 10px 34px rgba(74, 119, 255, 0.4)',
  },
  stopButton: {
    boxShadow: '0 10px 34px rgba(255, 72, 104, 0.36)',
  },
  buttonGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 36,
  },
  disabledButton: {
    opacity: 0.58,
  },
  pressedButton: {
    opacity: 0.78,
    transform: [{ scale: 0.97 }],
  },
  status: {
    marginTop: 13,
    color: palette.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: -0.35,
  },
  helper: {
    maxWidth: 286,
    marginTop: 5,
    color: palette.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  waveform: {
    height: 38,
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  waveBar: {
    width: 2,
    borderRadius: 2,
    backgroundColor: '#E7BC72',
    boxShadow: '0 0 8px rgba(100, 183, 239, 0.32)',
  },
  timer: {
    marginTop: 3,
    color: '#DDE5FF',
    fontSize: 16,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.5,
  },
  recordingActions: {
    width: '100%',
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  secondaryAction: {
    minHeight: 46,
    minWidth: 120,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: palette.surfaceSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  secondaryActionText: {
    color: palette.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  stopAction: {
    minHeight: 46,
    minWidth: 108,
    paddingHorizontal: 18,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.26)',
  },
  stopSquare: {
    width: 11,
    height: 11,
    borderRadius: 2,
    backgroundColor: palette.text,
  },
  stopActionText: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '600',
  },
  thinkingRow: {
    marginTop: 18,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: radii.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 252, 247, 0.055)',
  },
  thinkingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.blue,
    boxShadow: '0 0 10px rgba(97, 168, 255, 0.7)',
  },
  thinkingText: {
    color: palette.textSecondary,
    fontSize: 11,
  },
  transcriptBox: {
    width: '100%',
    marginTop: 17,
    padding: 14,
    borderRadius: radii.md,
    backgroundColor: 'rgba(255, 252, 247, 0.045)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  transcriptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  transcriptLabel: {
    color: palette.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  transcriptText: {
    marginTop: 8,
    color: palette.text,
    fontSize: 13,
    lineHeight: 19,
  },
  privacyRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  privacyText: {
    color: palette.textTertiary,
    fontSize: 10,
  },
});
