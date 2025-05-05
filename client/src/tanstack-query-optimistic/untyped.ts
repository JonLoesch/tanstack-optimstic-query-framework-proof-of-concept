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
  Query,
} from "@tanstack/react-query";
useMutation;
import {
  decorateClient,
  Spec,
  TransformQuerySpec,
  WatchMutationSpec,
} from "./decorate";
import { runSpecBuilder } from "./builder";
import {
  _MutationObserverIdleResult,
  _MutationObserverResult,
  _Query,
  AdjustTargetOutput,
  AnyDef,
} from "./def";

export const untypedOptimisticClient = runSpecBuilder(
  _buildUntypedOptimisticSpec
);

export const stopInjection = Symbol("stopInjection");
type StopOptimisticDataInjectionToken = typeof stopInjection;

export type ActiveMutationState<D extends AnyDef> = Exclude<
  _MutationObserverResult<D>,
  _MutationObserverIdleResult<D>
>;
export type Selectors<D extends AnyDef> = {
  from: MutationFilters;
  to:
    | QueryFilters
    | {
        static: QueryFilters;
        dynamic: (mutationState: ActiveMutationState<D>) => QueryFilters;
      };
};
export type UntypedConfigs<D extends AnyDef> = {
  optimisticData: Selectors<D> & {
    inject: (
      valuesFromServer: D["target"]["output"],
      mutation: ActiveMutationState<D>
    ) => D["target"]["output"] | StopOptimisticDataInjectionToken;
    emptyDefaultIfNoInitialQuery?: D["target"]["output"];
  };
  optimisticArrayInsert: Selectors<D> & {
    fakeValue: (input: D["source"]["input"]) => D["target"]["output"];
    matchValue(
      input: D["source"]["input"],
      fromServer: D["target"]["output"],
      mutationResult: D["target"]["output"] | undefined
    ): "no" | "exact" | "fuzzy" | undefined;
  };
  optimisticArrayRemove: Selectors<D> & {
    matchValue(
      input: D["source"]["input"],
      fromServer: D["target"]["output"],
    ): boolean;
  };
};

export function _buildUntypedOptimisticSpec(baseClient: QueryClient) {
  const transformQuery: TransformQuerySpec<AnyDef>[] = [];
  const watchMutation: WatchMutationSpec<AnyDef>[] = [];
  return {
    spec: () => ({ transformQuery, watchMutation }),
    builder: {
      optimisticData<D extends AnyDef>(
        config: UntypedConfigs<D>["optimisticData"]
      ) {
        const staticTargetQueryFilter =
          "static" in config.to ? config.to.static : config.to;
        const dynamicTargetQueryFilter = (
          mutationState: ActiveMutationState<D>
        ) =>
          "dynamic" in config.to ? config.to.dynamic(mutationState) : config.to;
        let autoInc = 0;
        const allMutationState = new Map<number, ActiveMutationState<D>>();
        const allQueryState = new Map<
          string,
          {
            query: _Query<D>;
            latestResultFromServer?: D["target"]["output"];
          }
        >();
        function getOrCreateQueryState(query: _Query<D>) {
          return allQueryState.has(query.queryHash)
            ? allQueryState.get(query.queryHash)!
            : allQueryState
                .set(query.queryHash, { query })
                .get(query.queryHash)!;
        }

        watchMutation.push({
          filter: config.from,
          watch: () => {
            const index = autoInc++;
            let abort = false;
            let lastStatus: MutationObserverResult["status"] = "pending";
            return {
              onEvent(event) {
                let needsClientSideRefresh = false;

                if (lastStatus !== event.status) {
                  lastStatus = event.status;
                  if (event.status === "success") {
                    baseClient.invalidateQueries(
                      dynamicTargetQueryFilter(event)
                    );
                  } else {
                    needsClientSideRefresh ||= true;
                  }
                }

                if (event.variables && event.status !== "idle") {
                  needsClientSideRefresh ||= !allMutationState.has(index);
                  allMutationState.set(index, event);

                  if (needsClientSideRefresh) {
                    const targetFilter = dynamicTargetQueryFilter(event);
                    for (const query of baseClient
                      .getQueryCache()
                      .findAll(targetFilter) as Array<_Query<D>>) {
                      const queryState = getOrCreateQueryState(query);

                      baseClient.setQueryData<D["target"]["output"]>(
                        query.queryKey,
                        (data) => {
                          const source = (queryState.latestResultFromServer ??=
                            data ?? config.emptyDefaultIfNoInitialQuery);
                          if (source) return evaluateQuery(query, source).value;
                        }
                      );
                    }
                  }
                }
              },
            };
          },
        } satisfies WatchMutationSpec<D>);

        transformQuery.push({
          filter: staticTargetQueryFilter,
          transform(fromServer, query) {
            const queryState = getOrCreateQueryState(query);
            const result = evaluateQuery(query, fromServer);
            queryState.latestResultFromServer = result.isAltered
              ? fromServer
              : undefined;
            return result.value;
          },
        } satisfies TransformQuerySpec<D>);

        function evaluateQuery(
          query: _Query<D>,
          source: D["target"]["output"]
        ) {
          let isAltered = false;

          let value = source;
          const toRemove = [];
          for (const [index, mutationState] of allMutationState) {
            if (mutationState.isError) {
              toRemove.push(index);
            } else {
              const newValue = config.inject(value, mutationState);
              if (newValue === stopInjection) {
                toRemove.push(index);
              } else {
                value = newValue;
                isAltered = true;
              }
            }
          }

          return { isAltered, value };
        }
      },

      optimisticArrayInsert<D extends AnyDef>({
        matchValue,
        fakeValue,
        ...config
      }: UntypedConfigs<D>["optimisticArrayInsert"]) {
        this.optimisticData<
          AdjustTargetOutput<D, Array<D["target"]["output"]>>
        >({
          ...config,
          emptyDefaultIfNoInitialQuery: [],
          inject(valuesFromServer: Array<D["target"]["output"]>, mutation) {
            let foundFuzzyMatch = false;
            for (const v of valuesFromServer) {
              switch (matchValue(mutation.variables, v, mutation.data)) {
                case "exact":
                  return stopInjection;
                case "fuzzy":
                  foundFuzzyMatch = true;
              }
            }
            return foundFuzzyMatch
              ? valuesFromServer
              : [...valuesFromServer, fakeValue(mutation.variables)];
          },
        });
      },
      optimisticArrayRemove<D extends AnyDef>({
        matchValue,
        ...config
      }: UntypedConfigs<D>["optimisticArrayRemove"]) {
        this.optimisticData<
        AdjustTargetOutput<D, Array<D["target"]["output"]>>
      >({
        ...config,
        emptyDefaultIfNoInitialQuery: [],
        inject(valuesFromServer: Array<D["target"]["output"]>, mutation) {
          if (mutation.isSuccess && !valuesFromServer.find(x => matchValue(mutation.variables, x))) {
            return stopInjection;
          } else {
            return valuesFromServer.filter(x => !matchValue(mutation.variables, x));
          }
        },
      });
      }
    },
  };
}
