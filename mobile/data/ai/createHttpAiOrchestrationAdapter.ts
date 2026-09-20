import type { AiOrchestrationPort } from '@/application/ports';
import type { AIRequest, AIResponse } from '@/domain';

const INTERPRET_PATH = '/api/ai/interpret';

export function createHttpAiOrchestrationAdapter(): AiOrchestrationPort {
  return {
    async interpret(request: AIRequest): Promise<AIResponse> {
      const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');
      if (!apiBaseUrl) {
        throw new Error('Die lokale Speicherung ist verfügbar, aber die Interpretation ist nicht konfiguriert.');
      }

      const response = await fetch(`${apiBaseUrl}${INTERPRET_PATH}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error('Die Interpretation ist derzeit nicht verfügbar.');
      }

      return (await response.json()) as AIResponse;
    },
  };
}
