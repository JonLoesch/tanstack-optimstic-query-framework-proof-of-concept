import { MutationKey, QueryClient, QueryKey } from "@tanstack/react-query";
import {
  ActiveMutationState,
  UntypedConfigs,
  _attachOptimisticFunctionality,
  type Selectors as UntypedSelectors,
} from "./untyped";
import { AdjustTargetOutput, AnyDef } from "./def";
import { InjectableQueryClient } from "./decorate";
import { AnyTRPCRouter } from "@trpc/server";
import { createTRPCOptionsProxy, TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { createTRPCClient } from "@trpc/client";

type Selectors<D extends AnyDef> = {
  from: {
    "~types": {
      input: D["source"]["input"];
      output: D["source"]["output"];
    };
    mutationKey: () => MutationKey;
  };
  to: {
    "~types": {
      input: D["target"]["input"];
      output: D["target"]["output"];
    };
    queryKey: (input: D["target"]["input"]) => D["target"]["queryKey"];
  };
};

type inferDef<S extends Selectors<any>> = {
  source: {
    input: S["from"]["~types"]["input"];
    output: S["from"]["~types"]["output"];
    error: any;
    context: any;
  };
  target: {
    input: S["to"]["~types"]["input"];
    output: S["to"]["~types"]["output"];
    error: any;
    outputPreTransform: any;
    queryKey: ReturnType<S["to"]["queryKey"]>;
  };
};

type TRPCConfigs<D extends AnyDef> = {
  [K in keyof UntypedConfigs<D>]: Omit<
    UntypedConfigs<D>[K],
    keyof UntypedSelectors<D>
  > & {
    queryParameters?: (
      mutationParameters: D["source"]["input"]
    ) => D["target"]["input"];
  };
};

export function createOptimisticTRPCClient<TRouter extends AnyTRPCRouter>(
  setupInjections: (
    builder: ReturnType<typeof _attachTRPCOptimisticFunctionality>,
    router: TRPCOptionsProxy<TRouter>
  ) => void,
  client?: InjectableQueryClient
): InjectableQueryClient {
  client ??= new InjectableQueryClient();
  const fakeTRPCProxy = createTRPCOptionsProxy<TRouter>({
    client: createTRPCClient<TRouter>({
      links: [],
    }),
    queryClient: new QueryClient(),
  });
  setupInjections(_attachTRPCOptimisticFunctionality(client), fakeTRPCProxy);
  return client;
}
export function _attachTRPCOptimisticFunctionality(queryClient: InjectableQueryClient) {
  const untyped = _attachOptimisticFunctionality(queryClient);
  return {
    untyped,

    optimisticArrayInsert<
      S extends Selectors<AnyDef>,
      D extends AdjustTargetOutput<
        inferDef<S>,
        inferDef<S>["target"]["output"][0]
      >
    >(
      s: S,
      { queryParameters, ...config }: TRPCConfigs<D>["optimisticArrayInsert"]
    ) {
      this.untyped.optimisticArrayInsert({
        ...untypedSelectors({ ...s, queryParameters }),
        ...config,
      });
    },

    optimisticArrayRemove<
      S extends Selectors<AnyDef>,
      D extends AdjustTargetOutput<
        inferDef<S>,
        inferDef<S>["target"]["output"][0]
      >
    >(
      s: S,
      { queryParameters, ...config }: TRPCConfigs<D>["optimisticArrayRemove"]
    ) {
      this.untyped.optimisticArrayRemove({
        ...untypedSelectors({ ...s, queryParameters }),
        ...config,
      });
    },

    optimisticData<S extends Selectors<AnyDef>, D extends inferDef<S>>(
      s: S,
      { queryParameters, ...config }: TRPCConfigs<D>["optimisticData"]
    ) {
      this.untyped.optimisticData({
        ...untypedSelectors({ ...s, queryParameters }),
        ...config,
      });
    },
  };
}

function untypedSelectors<D extends AnyDef>(
  selectors: Selectors<D> & {
    queryParameters?: (
      mutationParameters: D["source"]["input"]
    ) => D["target"]["input"];
  }
): UntypedSelectors<D> {
  const staticQueryKey = (
    selectors.to as unknown as { pathKey: () => QueryKey }
  ).pathKey();
  return {
    from: {
      mutationKey: selectors.from.mutationKey(),
    },
    to: (input) => {
        return ({
            queryKey: selectors.queryParameters
                ? selectors.to.queryKey(selectors.queryParameters(input))
                : staticQueryKey,
        });
    },
  };
}
