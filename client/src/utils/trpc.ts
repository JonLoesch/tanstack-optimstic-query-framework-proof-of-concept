import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { AppRouter } from "../../../server";
import { optimisticUpdatesViaLink } from "../optimistic-updates";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // ...
    },
  },
});

const trpcClient = createTRPCClient<AppRouter>({
  links: [
    ...optimisticUpdatesViaLink(queryClient),
    loggerLink(),
    httpBatchLink({ url: "http://localhost:3033" }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
