import { createContext, useContext, useMemo } from 'react';
import type { PropsWithChildren } from 'react';

import { createApplicationServices } from '@/application/services';
import type { ApplicationServices } from '@/application/services';
import { createHttpAiOrchestrationAdapter } from '@/data/ai/createHttpAiOrchestrationAdapter';
import { createOnDeviceTranscriptionProvider } from '@/data/transcription/createOnDeviceTranscriptionProvider';

import { useRepositories } from './RepositoryProvider';

const ApplicationContext = createContext<ApplicationServices | null>(null);

export function ApplicationProvider({ children }: PropsWithChildren) {
  const repositories = useRepositories();
  const services = useMemo(
    () => createApplicationServices(repositories, {
      ai: createHttpAiOrchestrationAdapter(),
      transcription: createOnDeviceTranscriptionProvider(),
    }),
    [repositories],
  );

  return <ApplicationContext.Provider value={services}>{children}</ApplicationContext.Provider>;
}

export function useApplicationServices(): ApplicationServices {
  const services = useContext(ApplicationContext);
  if (!services) {
    throw new Error('ApplicationProvider ist nicht verfügbar.');
  }
  return services;
}
