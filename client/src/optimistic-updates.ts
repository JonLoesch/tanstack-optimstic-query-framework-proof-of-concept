import { QueryClient } from "@tanstack/react-query";
import { TRPCLink } from "@trpc/client";
import { AppRouter } from "../../server";
import { createTRPCLinkProxy } from "./trpc-link";
import {
  optimisticTRPCClient,
  stopInjection,
} from "./tanstack-query-optimistic";
import { trpc } from "./utils/trpc";
import { SpecificDef } from "./tanstack-query-optimistic/def";

export function optimisticUpdatesViaLink(
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
    //
    // inject results into this TRPC query:
    //
    ...trpcLink.posts.allInThread.optimisticCache(
      [], // this is used if the injection happens before we fetch even a single value from the server. -- probably we don't need this?
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
        //
        // inject results by hooking into this TRPC mutation:
        //
        trpcLink.posts.delete.optimisticDataSource({
          queryParameters: (input) => ({ threadId: input.threadId }), // the parameters to the `posts.allInThread` query
          injectNewData(
            // this gets added to an internal bag of functions that alter the apparent value `posts.allInThread`
            fromServer, // the return type of `posts.allInThread`
            toRemove, // the input type of `posts.delete`
            mutationComplete // the return `posts.delete` (or undefined if it's still in flight.  probably this should be a more fully formed mutation state object?)
          ) {
            if (
              //
              // if the mutation has finished and we can see that the toRemove id is gone from the list,
              // then we can cancel this injection.  By returning the stopInjection() token, this `injectNewData` function will be removed from the bag of functions altering the return value.
              //
              mutationComplete &&
              !fromServer.find((x) => x.id === toRemove.id)
            ) {
              return trpcLink.stopInjection();
            } else {
              // until
              return fromServer.filter((x) => x.id !== toRemove.id);
            }
          },
        }),
      ]
    ),
  ];
}

export function optimisticUpdatesViaTanstackDecoration(
  baseClient?: QueryClient
) {
  return optimisticTRPCClient((builder) => {
    builder.optimisticArrayInsert(
      {
        from: trpc.threads.create,
        to: trpc.threads.all,
      },
      {
        queryParameters: () => undefined,
        fakeValue: (input) => ({ ...input, id: -1 }),
        matchValue(input, fromServer, mutationResult) {
          if (mutationResult?.id === fromServer.id) return "exact";
          if (input.title === fromServer.title) return "fuzzy";
        },
      }
    );

    // builder.untyped.optimisticArrayInsert({
    //   from: { mutationKey: [["threads", "create"]] },
    //   to: { queryKey: [["threads", "all"]] },
    //   fakeValue: (input) => ({ ...input, id: -1 }),
    //   matchValue(input, fromServer, mutationResult) {
    //     if (mutationResult?.id === fromServer.id) return "exact";
    //     if (input.title === fromServer.title) return "fuzzy";
    //   },
    // });

    builder.optimisticArrayRemove(
      {
        from: trpc.threads.delete,
        to: trpc.threads.all,
      },
      {
        queryParameters: () => undefined,
        matchValue(input, fromServer) {
          return input.id == fromServer.id;
        },
      }
    );

    builder.optimisticArrayInsert(
      {
        from: trpc.posts.create,
        to: trpc.posts.allInThread,
      },
      {
        queryParameters(mutationParameters) {
          return { threadId: mutationParameters.threadId };
        },
        fakeValue: (input) => ({ ...input, id: -1 }),
        matchValue(input, fromServer, mutationResult) {
          if (mutationResult?.id === fromServer.id) return "exact";
          if (input.content === fromServer.content) return "fuzzy";
        },
      }
    );

    builder.optimisticArrayRemove(
      {
        from: trpc.posts.delete,
        to: trpc.posts.allInThread,
      },
      {
        queryParameters(mutationParameters) {
          return { threadId: mutationParameters.threadId };
        },
        matchValue: (input, fromServer) => input.id === fromServer.id,
      }
    );

    // builder.untyped.optimisticArrayRemove({
    //   from: { mutationKey: [["posts", "delete"]] },
    //   to: {
    //     static: { queryKey: [["posts", "allInThread"]] },
    //     dynamic: (mutationState) => ({
    //       queryKey: [
    //         ["posts", "allInThread"],
    //         { threadId: mutationState.variables.threadId },
    //       ],
    //     }),
    //   },
    //   matchValue: (input, fromServer) => input.id === fromServer.id,
    // });
  }, baseClient);
}
