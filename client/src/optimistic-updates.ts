import { QueryClient } from "@tanstack/react-query";
import { TRPCLink } from "@trpc/client";
import { AppRouter } from "../../server";
import { createTRPCLinkProxy } from "./trpc-link";

export function optimisticUpdates(
  queryClient: QueryClient
): TRPCLink<AppRouter>[] {
  const trpcLink = createTRPCLinkProxy<AppRouter>(queryClient);

  return [
    ...trpcLink.threads.all.optimisticCache(
      [],
      [
        trpcLink.threads.create.optimisticDataSource({
          queryParameters: () => undefined,
          injectNewData(fromServer, newData, mutationComplete) {
            if (
              mutationComplete &&
              fromServer.find((x) => x.id === mutationComplete.id)
            ) {
              return trpcLink.stopInjection();
            } else {
              return [...fromServer, { ...newData, id: -1 }];
            }
          },
        }),
        trpcLink.threads.delete.optimisticDataSource({
          queryParameters: () => undefined,
          injectNewData(fromServer, toRemove, mutationComplete) {
            if (
              mutationComplete &&
              !fromServer.find((x) => x.id === toRemove.id)
            ) {
              return trpcLink.stopInjection();
            } else {
              return fromServer.filter((x) => x.id !== toRemove.id);
            }
          },
        }),
      ]
    ),
    ...trpcLink.posts.allInThread.optimisticCache(
      [],
      [
        trpcLink.posts.create.optimisticDataSource({
          queryParameters: (input) => ({ threadId: input.threadId }),
          injectNewData(fromServer, newData, mutationComplete) {
            if (
              mutationComplete &&
              fromServer.find((x) => x.id === mutationComplete.id)
            ) {
              return trpcLink.stopInjection();
            } else {
              return [...fromServer, { ...newData, id: -1 }];
            }
          },
        }),
        trpcLink.posts.delete.optimisticDataSource({
          queryParameters: (input) => ({ threadId: input.threadId }),
          injectNewData(fromServer, toRemove, mutationComplete) {
            if (
              mutationComplete &&
              !fromServer.find((x) => x.id === toRemove.id)
            ) {
              return trpcLink.stopInjection();
            } else {
              return fromServer.filter((x) => x.id !== toRemove.id);
            }
          },
        }),
      ]
    ),
  ];
}
