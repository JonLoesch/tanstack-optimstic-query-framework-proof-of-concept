import {
  MutationFilters,
  QueryFilters,
  MutationObserverResult,
  DefaultError,
  QueryClient,
  QueryKey,
  MutationKey,
  MutationObserverOptions,
  hashKey,
  useMutation,
  MutationObserverIdleResult,
} from "@tanstack/react-query";
useMutation;
import {
  options,
  Spec,
  TransformQuerySpec,
  WatchMutationSpec,
} from "./decorate";

export interface Builder {
  optimisticData: <TSourceInput, TSourceOutput, TTargetInput, TTargetOutput>(
    config: OptimisticConfig<
      TSourceInput,
      TSourceOutput,
      TTargetInput,
      TTargetOutput
    >,
    queryClient: QueryClient
  ) => void;
}

export type OptimisticConfig<
  TSourceInput,
  TSourceOutput,
  TTargetInput,
  TTargetOutput
> = {
  from: MutationKey;
  to: {
    prefix: QueryKey;
    specific?: (mutationParameters: TSourceInput) => QueryKey;
  };

  inject: (
    valuesFromServer: TTargetOutput,
    mutation: Exclude<
      MutationObserverResult<TSourceOutput, DefaultError, TSourceInput>,
      MutationObserverIdleResult<TSourceOutput, DefaultError, TSourceInput>
    >
  ) => TTargetOutput | StopOptimisticDataInjectionToken;
};

export const stopInjection = Symbol("stopInjection");
type StopOptimisticDataInjectionToken = typeof stopInjection;

export function makeSpec(factory: (builder: Builder) => void): Spec {
  const result: Spec = {
    transformQuery: [],
    watchMutation: [],
  };
  factory({
    optimisticData<TSourceInput, TSourceOutput, TTargetInput, TTargetOutput>(
      config: OptimisticConfig<
        TSourceInput,
        TSourceOutput,
        TTargetInput,
        TTargetOutput
      >,
      queryClient: QueryClient
    ) {
      let autoInc = 0;
      const optimisticState = new Map<
        string,
        {
          latestUnmodifiedValue?: TTargetOutput;
          activeInjections: Map<
            number,
            (
              valueFromServer: TTargetOutput
            ) => TTargetOutput | StopOptimisticDataInjectionToken
          >;
          evaluate: (fromServer: TTargetOutput) => TTargetOutput;
        }
      >();

      function optimisticLogicByHash(hash: string) {
        return optimisticState.has(hash)
          ? optimisticState.get(hash)!
          : optimisticState
              .set(hash, {
                activeInjections: new Map(),
                evaluate(fromServer) {
                  this.latestUnmodifiedValue = fromServer;

                  let v = fromServer;
                  const toRemove = [];
                  for (const [index, injection] of this.activeInjections) {
                    const update = injection(v);
                    if (update === stopInjection) {
                      toRemove.push(index);
                    } else {
                      v = update;
                    }
                  }

                  if (this.activeInjections.size === 0) {
                    this.latestUnmodifiedValue = undefined;
                  }
                  return v;
                },
              })
              .get(hash)!;
      }

      result.watchMutation.push({
        filter: {
          mutationKey: config.from,
        },
        watch: () => {
          const index = autoInc++;
          let abort = false;
          let lastStatus: MutationObserverResult["status"] = "pending";
          return options({
            onEvent(event) {
              let dirty = false;

              if (lastStatus !== event.status) {
                lastStatus = event.status;
                if (event.status === "success") {
                  queryClient.invalidateQueries({
                    queryKey: event.context.queryKey,
                  });
                } else {
                  dirty ||= true;
                }
              }

              if (event.variables && event.status !== "idle") {
                const queryKey: QueryKey = [
                  ...config.to.prefix,
                  ...(config.to.specific?.(event.variables) ?? []),
                ];
                const logic = optimisticLogicByHash(hashKey(queryKey));
                if (logic.activeInjections.size == 0) {
                  logic.latestUnmodifiedValue =
                    queryClient.getQueryData<TTargetOutput>(queryKey);
                }
                dirty ||= !logic.activeInjections.has(index);
                logic.activeInjections.set(
                  index,
                  (valueFromServer: TTargetOutput) => {
                    if (event.isError) {
                      return stopInjection;
                    } else {
                      return config.inject(valueFromServer, event);
                    }
                  }
                );

                if (dirty) {
                  queryClient.setQueryData<TTargetOutput>(queryKey, (x) =>
                    x ? logic.evaluate(x) : undefined
                  );
                }
              }
            },
          });
        },
      } satisfies WatchMutationSpec<TSourceInput, TSourceOutput>);

      result.transformQuery.push({
        filter: {
          queryKey: config.to.prefix,
        },
        transform(fromServer, query) {
          return optimisticLogicByHash(query.queryHash).evaluate(fromServer);
        },
      } satisfies TransformQuerySpec<TTargetInput, TTargetOutput>);
    },
  });
  return result;
}
