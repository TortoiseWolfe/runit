import { createContext, useContext, type ReactNode } from 'react';

import type { RunitRepository } from '@/data/repository';

const RepositoryContext = createContext<RunitRepository | null>(null);

export function RepositoryProvider({
  repository,
  children,
}: {
  repository: RunitRepository;
  children: ReactNode;
}) {
  return <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>;
}

export function useRepository(): RunitRepository {
  const r = useContext(RepositoryContext);
  if (!r) throw new Error('useRepository must be used inside <RepositoryProvider>');
  return r;
}
