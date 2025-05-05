import { MutationKey, QueryClient, QueryKey } from "@tanstack/react-query";
import { trpc } from "../utils/trpc";
import {
  ActiveMutationState,
  UntypedConfigs,
  _buildUntypedOptimisticSpec,
  stopInjection,
  type Selectors as UntypedSelectors,
} from "./untyped";
import { runSpecBuilder } from "./builder";
import { AdjustTargetOutput, AnyDef } from "./def";

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
    queryParameters: (
      mutationParameters: D["source"]["input"]
    ) => D["target"]["input"];
  };
};

export const optimisticTRPCClient = runSpecBuilder(_buildTRPCOptimisticClient);
export function _buildTRPCOptimisticClient(queryClient: QueryClient) {
  const untyped = _buildUntypedOptimisticSpec(queryClient);
  return {
    spec: untyped.spec,
    builder: {
      untyped: untyped.builder,

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
    },
  };
}

optimisticTRPCClient((builder) => {});

// return [
//     ...trpc.threads.all.optimisticCache(
//       [],
//       [
//         trpcLink.threads.create.optimisticDataSource({
//           queryParameters: () => undefined,
//           injectNewData(fromServer, newData, mutationComplete) {
//             if (
//               mutationComplete &&
//               fromServer.find((x) => x.id === mutationComplete.id)
//             ) {
//               return trpcLink.stopInjection();
//             } else {
//               return [...fromServer, { ...newData, id: -1 }];
//             }
//           },
//         }),
//         trpcLink.threads.delete.optimisticDataSource({
//           queryParameters: () => undefined,
//           injectNewData(fromServer, toRemove, mutationComplete) {
//             if (
//               mutationComplete &&
//               !fromServer.find((x) => x.id === toRemove.id)
//             ) {
//               return trpcLink.stopInjection();
//             } else {
//               return fromServer.filter((x) => x.id !== toRemove.id);
//             }
//           },
//         }),
//       ]
//     ),

function untypedSelectors<D extends AnyDef>(
  selectors: Selectors<D> & {
    queryParameters: (
      mutationParameters: D["source"]["input"]
    ) => D["target"]["input"];
  }
): UntypedSelectors<D> {
  return {
    from: {
      mutationKey: selectors.from.mutationKey(),
    },
    to: {
      static: {
        queryKey: (
          selectors.from as unknown as { pathKey: () => QueryKey }
        ).pathKey(),
      },
      dynamic(mutationState: ActiveMutationState<D>) {
        return {
          queryKey: selectors.to.queryKey(
            selectors.queryParameters(mutationState.variables)
          ),
        };
      },
    },
  };
}
