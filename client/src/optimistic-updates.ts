import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, TRPCLink } from "@trpc/client";
import { AppRouter } from "../../server";
import { createTRPCLinkProxy } from "./trpc-link";
import {
  optimisticTRPCClient,
  stopInjection,
} from "./tanstack-query-optimistic";
import { SpecificDef } from "./tanstack-query-optimistic/def";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { InjectableQueryClient } from "./tanstack-query-optimistic/decorate";


export function optimisticUpdatesViaTanstackDecoration(
  baseClient?: InjectableQueryClient
) {

  return optimisticTRPCClient<AppRouter>((builder, trpc) => {
    let autoDec = -1;
    builder.optimisticArrayInsert(
      {
        from: trpc.threads.create,
        to: trpc.threads.all,
      },
      {
        fakeValue: (input) => ({ ...input, id: autoDec-- }),
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
        fakeValue: (input) => ({ ...input, id: autoDec-- }),
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
