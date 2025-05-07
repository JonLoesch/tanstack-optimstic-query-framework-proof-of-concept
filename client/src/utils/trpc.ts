import { createTRPCClient, httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { AppRouter } from "../../../server";
import { optimisticUpdatesViaTanstackDecoration } from "../optimistic-updates";
import {
  InjectableQueryClient,
} from "../tanstack-query-optimistic/decorate";

export const queryClient = optimisticUpdatesViaTanstackDecoration(
  new InjectableQueryClient({
    defaultOptions: {
      queries: {
        // ...
      },
    },
  })
);

const trpcClient = createTRPCClient<AppRouter>({
  links: [
    // ...optimisticUpdatesViaLink(queryClient),
    loggerLink(),
    httpBatchLink({ url: "http://localhost:3033" }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
