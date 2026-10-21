import { QueryClientProvider } from '@tanstack/react-query';
import { Boot } from './app/Boot';
import { queryClient } from './data/query-client';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Boot />
    </QueryClientProvider>
  );
}
