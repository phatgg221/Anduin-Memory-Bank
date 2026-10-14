"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { accessTokenStore } from "@/lib/accessToken";
import { queryKeys } from "@/store/queryKeys";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );

  // A rejected token refresh (in the axios interceptor) ends the session everywhere in the UI.
  useEffect(
    () => accessTokenStore.onExpired(() => client.setQueryData(queryKeys.auth.session, null)),
    [client],
  );

  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}
