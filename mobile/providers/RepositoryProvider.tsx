import { createContext, useContext, useMemo } from 'react';
import type { PropsWithChildren } from 'react';
import { useSQLiteContext } from 'expo-sqlite';

import { createRepositories } from '@/data/repositories/createRepositories';
import type { Repositories } from '@/domain';

const RepositoryContext = createContext<Repositories | null>(null);

export function RepositoryProvider({ children }: PropsWithChildren) {
  const database = useSQLiteContext();
  const repositories = useMemo(() => createRepositories(database), [database]);

  return <RepositoryContext.Provider value={repositories}>{children}</RepositoryContext.Provider>;
}

export function useRepositories(): Repositories {
  const repositories = useContext(RepositoryContext);
  if (!repositories) {
    throw new Error('RepositoryProvider ist nicht verfügbar.');
  }
  return repositories;
}
