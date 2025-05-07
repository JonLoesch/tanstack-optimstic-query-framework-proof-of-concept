import {
  MutationFilters,
  QueryFilters,
  MutationObserverResult,
  hashKey,
  useMutation,
  MutationState,
  MutationObserverIdleResult,
} from "@tanstack/react-query";
useMutation;
import { InjectableQueryClient, stopInjection } from "./decorate";
import {
  _MutationObserverIdleResult,
  _MutationObserverResult,
  _Query,
  AdjustTargetOutput,
  AnyDef,
} from "./def";
import { _attachTRPCOptimisticFunctionality } from "./trpc";

export function untypedOptimisticClient(
  setupInjections: (
    builder: ReturnType<typeof _attachTRPCOptimisticFunctionality>
  ) => void,
  client?: InjectableQueryClient
): InjectableQueryClient {
  client ??= new InjectableQueryClient();
  setupInjections(_attachTRPCOptimisticFunctionality(client));
  return client;
}

export type ActiveMutationState<D extends AnyDef> = Exclude<
  _MutationObserverResult<D>,
  _MutationObserverIdleResult<D>
>;
export type Selectors<D extends AnyDef> = {
  from: MutationFilters;
  to: (mutationState: D["source"]["input"]) => QueryFilters;
};
export type UntypedConfigs<D extends AnyDef> = {
  optimisticData: Selectors<D> & {
    inject: () => (
      valuesFromServer: D["target"]["output"],
      mutationState: ActiveMutationState<D>
    ) => D["target"]["output"] | typeof stopInjection;
    emptyDefaultIfMutationBeforeQuery: D["target"]["output"];
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
      fromServer: D["target"]["output"]
    ): boolean;
  };
};

export function _attachOptimisticFunctionality(client: InjectableQueryClient) {
  return {
    optimisticData<D extends AnyDef>(
      config: UntypedConfigs<D>["optimisticData"]
    ) {
      return client.watchMutationEvents<D["source"]["input"]>(
        config.from,
        () => {
          let queryInjection:
            | undefined
            | ReturnType<InjectableQueryClient["injectQueryData"]>;
          let lastStatus: MutationState["status"] = "pending";
          return {
            unsubscribe() {
              queryInjection?.unsubscribe();
            },
            onChange(event) {
              if (event.status !== "idle") {
                queryInjection ??= client.injectQueryData<
                  D["target"]["output"]
                >(config.to(event.variables), config.emptyDefaultIfMutationBeforeQuery, () => {
                  const transform = config.inject();
                  return {
                    transformData(data) {
                      if (event.isError) return stopInjection;
                      return transform(data, event);
                    },
                  };
                });
              }

              let needsClientSideRefresh = false;

              if (lastStatus !== event.status) {
                lastStatus = event.status;
                needsClientSideRefresh ||= true;
                if (event.status === "success") {
                  queryInjection?.invalidateAndRefetch();
                }
              }

              if (needsClientSideRefresh) {
                queryInjection?.refresh();
              }
            },
          };
        }
      );
    },
    optimisticArrayInsert<D extends AnyDef>({
      matchValue,
      fakeValue,
      ...config
    }: UntypedConfigs<D>["optimisticArrayInsert"]) {
      this.optimisticData<AdjustTargetOutput<D, Array<D["target"]["output"]>>>({
        ...config,
        emptyDefaultIfMutationBeforeQuery: [],
        inject: () => {
          let fake: D["target"]["output"] | undefined;
          return (
            valuesFromServer: Array<D["target"]["output"]>,
            mutationState
          ) => {
            let foundFuzzyMatch = false;
            for (const v of valuesFromServer) {
              switch (
                matchValue(mutationState.variables, v, mutationState.data)
              ) {
                case "exact":
                  return stopInjection;
                case "fuzzy":
                  foundFuzzyMatch = true;
              }
            }
            return foundFuzzyMatch
              ? valuesFromServer
              : [
                  ...valuesFromServer,
                  (fake = fake ?? fakeValue(mutationState.variables)),
                ];
          };
        },
      });
    },
    optimisticArrayRemove<D extends AnyDef>({
      matchValue,
      ...config
    }: UntypedConfigs<D>["optimisticArrayRemove"]) {
      this.optimisticData<AdjustTargetOutput<D, Array<D["target"]["output"]>>>({
        ...config,
        emptyDefaultIfMutationBeforeQuery: [],
        inject:
          () =>
          (valuesFromServer: Array<D["target"]["output"]>, mutationState) => {
            if (
              mutationState.isSuccess &&
              valuesFromServer.find((x) =>
                matchValue(mutationState.variables, x)
              )
            ) {
              return stopInjection;
            } else {
              return valuesFromServer.filter(
                (x) => !matchValue(mutationState.variables, x)
              );
            }
          },
      });
    },
  };
}
