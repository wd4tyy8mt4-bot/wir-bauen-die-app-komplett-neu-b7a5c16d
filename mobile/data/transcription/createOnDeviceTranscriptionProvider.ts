import { Platform } from 'react-native';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

import type { TranscriptionProvider } from '@/application/ports';
import type { TranscriptionResponse } from '@/domain';

const PROVIDER_KEY = 'ios_on_device_speech';

function unavailable(errorCode: string): TranscriptionResponse {
  return {
    status: 'unavailable',
    provider: PROVIDER_KEY,
    errorCode,
  };
}

export function createOnDeviceTranscriptionProvider(): TranscriptionProvider {
  return {
    key: PROVIDER_KEY,
    async transcribe(request) {
      if (Platform.OS !== 'ios') {
        return unavailable('on_device_transcription_requires_ios');
      }
      if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
        return unavailable('on_device_recognition_not_supported');
      }

      try {
        const supported = await ExpoSpeechRecognitionModule.getSupportedLocales({});
        const localeSupported = supported.locales.some((locale) =>
          locale.toLowerCase() === request.locale.toLowerCase()
          || locale.toLowerCase().startsWith('de'),
        );
        if (!localeSupported) {
          return unavailable('german_locale_not_supported');
        }
      } catch {
        return unavailable('locale_availability_unknown');
      }

      return new Promise<TranscriptionResponse>((resolve) => {
        let transcript = '';
        let confidence: number | undefined;
        let settled = false;
        const timeoutMs = Math.min(Math.max((request.durationMs ?? 0) * 2 + 15_000, 30_000), 360_000);

        const cleanup = () => {
          resultSubscription.remove();
          errorSubscription.remove();
          endSubscription.remove();
          clearTimeout(timeout);
        };
        const finish = (response: TranscriptionResponse) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(response);
        };

        const resultSubscription = ExpoSpeechRecognitionModule.addListener('result', (event) => {
          const candidate = event.results[0];
          if (candidate?.transcript) {
            const nextTranscript = candidate.transcript.trim();
if (nextTranscript) {
  transcript = transcript
    ? `${transcript} ${nextTranscript}`.trim()
    : nextTranscript;
}
            confidence = candidate.confidence;
          }
        });
        const errorSubscription = ExpoSpeechRecognitionModule.addListener('error', (event) => {
          const unavailableErrors = new Set([
            'language-not-supported',
            'service-not-allowed',
            'recognizer-busy',
          ]);
          finish({
            status: unavailableErrors.has(event.error) ? 'unavailable' : 'failed',
            provider: PROVIDER_KEY,
            errorCode: event.error || 'transcription_failed',
          });
        });
        const endSubscription = ExpoSpeechRecognitionModule.addListener('end', () => {
          finish(transcript
            ? {
              status: 'completed',
              provider: PROVIDER_KEY,
              transcript,
              confidence,
            }
            : {
              status: 'empty',
              provider: PROVIDER_KEY,
              errorCode: 'no_speech_recognized',
            });
        });
        const timeout = setTimeout(() => {
          ExpoSpeechRecognitionModule.abort();
          finish({
            status: 'failed',
            provider: PROVIDER_KEY,
            errorCode: 'transcription_timeout',
          });
        }, timeoutMs);

        try {
          ExpoSpeechRecognitionModule.start({
            lang: request.locale,
            continuous: true,
            interimResults: true,
            maxAlternatives: 1,
            requiresOnDeviceRecognition: true,
            addsPunctuation: true,
            audioSource: { uri: request.audioUri },
          });
        } catch {
          finish({
            status: 'failed',
            provider: PROVIDER_KEY,
            errorCode: 'transcription_could_not_start',
          });
        }
      });
    },
  };
}
