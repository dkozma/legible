import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext } from 'react';
import type { LegibleClient } from './client';

const ClientContext = createContext<LegibleClient | null>(null);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

export function Providers({ client, children }: { client: LegibleClient; children: ReactNode }) {
  return (
    <ClientContext.Provider value={client}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ClientContext.Provider>
  );
}

export function useClient(): LegibleClient {
  const c = useContext(ClientContext);
  if (!c) throw new Error('LegibleClient missing');
  return c;
}
