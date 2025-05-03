import type {
  AnyTRPCRouter,
  TRPCRouterRecord,
  AnyTRPCProcedure,
  inferProcedureInput,
  inferTransformedProcedureOutput,
  TRPCProcedureType,
} from "@trpc/server";
import { createRecursiveProxy } from "@trpc/server/unstable-core-do-not-import";
import type { TRPCMutationKey, TRPCQueryKey } from "@trpc/tanstack-react-query";
import { isFunction, isObject } from "@trpc/server/unstable-core-do-not-import";
import { skipToken, type QueryClient } from "@tanstack/react-query";
import type { OperationLink, TRPCLink } from "@trpc/client";
import { map, tap } from "@trpc/server/observable";

/**
 * To allow easy interactions with groups of related queries, such as
 * invalidating all queries of a router, we use an array as the path when
 * storing in tanstack query.
 *
 * @internal
 */
function getQueryKeyInternal(
  path: readonly string[],
  input?: unknown,
  type?: "any" | "infinite" | "query"
): TRPCQueryKey {
  // Construct a query key that is easy to destructure and flexible for
  // partial selecting etc.
  // https://github.com/trpc/trpc/issues/3128

  // some parts of the path may be dot-separated, split them up
  const splitPath = path.flatMap((part) => part.split("."));

  if (!input && (!type || type === "any")) {
    // this matches also all mutations (see `getMutationKeyInternal`)

    // for `utils.invalidate()` to match all queries (including vanilla react-query)
    // we don't want nested array if path is empty, i.e. `[]` instead of `[[]]`
    return splitPath.length ? [splitPath] : ([] as unknown as TRPCQueryKey);
  }

  if (
    type === "infinite" &&
    isObject(input) &&
    ("direction" in input || "cursor" in input)
  ) {
    const {
      cursor: _,
      direction: __,
      ...inputWithoutCursorAndDirection
    } = input;
    return [
      splitPath,
      {
        input: inputWithoutCursorAndDirection,
        type: "infinite",
      },
    ];
  }

  return [
    splitPath,
    {
      ...(typeof input !== "undefined" &&
        input !== skipToken && { input: input }),
      ...(type && type !== "any" && { type: type }),
    },
  ];
}

/**
 * @internal
 */
export function getMutationKeyInternal(
  path: readonly string[]
): TRPCMutationKey {
  // some parts of the path may be dot-separated, split them up
  const splitPath = path.flatMap((part) => part.split("."));

  return splitPath.length ? [splitPath] : ([] as unknown as TRPCMutationKey);
}

type EndpointProxy<TRouter extends AnyTRPCRouter> = EndpointProxyRecord<
  TRouter["_def"]["_config"]["$types"],
  TRouter["_def"]["record"]
> & {
  stopInjection: () => StopOptimisticDataInjectionToken;
};
type EndpointProxyRecord<
  TRouter extends AnyTRPCRouter,
  TRecord extends TRPCRouterRecord
> = {
  [TKey in keyof TRecord]: TRecord[TKey] extends infer $Value
    ? $Value extends TRPCRouterRecord
      ? EndpointProxyRecord<TRouter, $Value>
      : $Value extends AnyTRPCProcedure
      ? Endpoint<
          $Value["_def"]["type"],
          inferProcedureInput<$Value>,
          inferTransformedProcedureOutput<
            TRouter["_def"]["_config"]["$types"],
            $Value
          >
          // TRouter["_def"]["_config"]["$types"]["errorShape"],
          // TRouter["_def"]["_config"]["$types"]["transformer"]
        >
      : never
    : never;
};

type Endpoint<TEndpointType extends TRPCProcedureType, TInput, TOutput> = {
  pathKey: () => TRPCQueryKey;
} & (TEndpointType extends "query"
  ? {
      queryKey: (input: TInput) => TRPCQueryKey;
      optimisticCache: (
        defaultValue: TOutput,
        sources: AnyOptimisticCacheSource<TInput, TOutput>[]
      ) => TRPCLink<AnyTRPCRouter>[];
    }
  : TEndpointType extends "mutation"
  ? {
      mutationKey: () => TRPCQueryKey;
      optimisticDataSource: <TTargetInput, TTargetOutput>(params: {
        injectNewData: (
          fromServer: TTargetOutput,
          newData: TInput,
          mutationComplete: TOutput | undefined
        ) => TTargetOutput | StopOptimisticDataInjectionToken;
        queryParameters: (newData: TInput) => TTargetInput;
      }) => AnyOptimisticCacheSource<TTargetInput, TTargetOutput>;
    }
  : {
      subscriptionKey: (input: TInput) => TRPCQueryKey;
    });

const stopInjection = Symbol("stopInjection");
type StopOptimisticDataInjectionToken = typeof stopInjection;
type DataMap<TOutput> = (
  fromServer: TOutput
) => TOutput | StopOptimisticDataInjectionToken;
type MutationMethods<TTargetInput, TTargetOutput, TOutput> = {
  injectOptimisticData: DataMap<TTargetOutput>;
  queryParameters: TTargetInput;
  onSuccess?: (mutationResult: TOutput) => void;
};

type OptimisticCacheSource<TTargetInput, TTargetOutput, TInput, TOutput> = {
  mutationPathKey: TRPCQueryKey;
  onMutate: (
    input: TInput
  ) => MutationMethods<TTargetInput, TTargetOutput, TOutput>;
};
type AnyOptimisticCacheSource<TTargetInput, TTargetOutput> =
  OptimisticCacheSource<
    TTargetInput,
    TTargetOutput,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any
  >;

function optimisticDataSource_implementation<
  TInput,
  TOutput,
  TTargetInput,
  TTargetOutput
>(params: {
  injectNewData: (
    fromServer: TTargetOutput,
    newData: TInput,
    mutationComplete: TOutput | undefined
  ) => TTargetOutput | StopOptimisticDataInjectionToken;
  queryParameters: (newData: TInput) => TTargetInput;
}): OptimisticCacheSource<
  TTargetInput,
  TTargetOutput,
  TInput,
  TOutput
>["onMutate"] {
  return (input) => {
    let result: TOutput | undefined;
    return {
      queryParameters: params.queryParameters(input),
      injectOptimisticData: (fromServer) =>
        params.injectNewData(fromServer, input, result),
      onSuccess(mutationResult) {
        result = mutationResult;
      },
    };
  };
}

export function createTRPCLinkProxy<TRouter extends AnyTRPCRouter>(
  queryClient: QueryClient
) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  const methods = implementation() as Record<string, Function>;
  return createRecursiveProxy<EndpointProxy<TRouter>>(
    ({ path: _path, args }) => {
      const path = [..._path]; // _path is readonly, we make a copy first thing.
      const methodName = path.pop()!;
      return methods[methodName]!.call(methods, path, ...args);
    }
  );

  function implementation<TInput, TOutput>(): EndpointImplementation<
    TInput,
    TOutput
  > {
    return {
      mutationKey(path) {
        return getMutationKeyInternal(path);
      },
      queryKey(path, input) {
        return getQueryKeyInternal(path, input, "query");
      },
      subscriptionKey(path, input) {
        return getQueryKeyInternal(path, input, "any");
      },
      optimisticDataSource(path, params) {
        return {
          mutationPathKey: this.pathKey(path),
          onMutate: optimisticDataSource_implementation(params),
        };
      },
      optimisticCache(path, defaultValue, sources) {
        const cache: Record<
          string,
          {
            attachedOptimisticUpdates: Array<
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              MutationMethods<TInput, TOutput, any>
            >;
            latestValueFromServer: TOutput;
          }
        > = {};

        const withInput = (input: TInput) => {
          // eslint-disable-next-line @typescript-eslint/no-base-to-string
          const queryKey = this.queryKey(path, input).flat().join(".");
          return (
            cache[queryKey] ??
            (cache[queryKey] = {
              attachedOptimisticUpdates: [],
              latestValueFromServer: defaultValue,
            })
          );
        };

        function evaluate(input: TInput, fromServer: TOutput) {
          const { attachedOptimisticUpdates } = withInput(input);
          const toRemove: number[] = [];
          attachedOptimisticUpdates.forEach((m, index) => {
            const altered = m.injectOptimisticData(fromServer);
            if (altered === stopInjection) {
              toRemove.push(index);
            } else {
              fromServer = altered;
            }
          });
          toRemove.forEach((r) => attachedOptimisticUpdates.splice(r, 1));
          return fromServer;
        }

        const watchThis = scope(this.pathKey(path), ({ op, next }) => {
          return next(op).pipe(
            map((value) => {
              if (value.result.data) {
                withInput(op.input);
                return {
                  ...value,
                  result: {
                    ...value.result,
                    data: evaluate(op.input, value.result.data),
                  },
                } as typeof value;
              } else {
                return value;
              }
            }),
            tap({
              next(value) {
                if (value.result.data) {
                  withInput(op.input).latestValueFromServer = value.result.data;
                }
              },
            })
          );
        });

        const watchSources = sources.map((mutationDataSource) => {
          return scope(mutationDataSource.mutationPathKey, ({ op, next }) => {
            const mutationMethods = mutationDataSource.onMutate(op.input);
            const refreshWithoutRefetching = () => {
              queryClient.setQueryData(
                getQueryKeyInternal(
                  path,
                  mutationMethods.queryParameters,
                  "query"
                ),
                evaluate(
                  mutationMethods.queryParameters,
                  withInput(mutationMethods.queryParameters)
                    .latestValueFromServer
                )
              );
            };
            let aborted = false;
            withInput(
              mutationMethods.queryParameters
            ).attachedOptimisticUpdates.push({
              ...mutationMethods,
              injectOptimisticData: (fromServer) =>
                aborted
                  ? stopInjection
                  : mutationMethods.injectOptimisticData(fromServer),
            });
            refreshWithoutRefetching();
            return next(op).pipe(
              tap({
                next(value) {
                  const data = value.result.data;
                  if (data) mutationMethods.onSuccess?.(data);
                  queryClient.invalidateQueries({
                    queryKey: getQueryKeyInternal(
                      path,
                      mutationMethods.queryParameters,
                      "query"
                    ),
                  });
                },
                error(err) {
                  aborted = true;
                  refreshWithoutRefetching();
                },
              })
            );
          });
        });
        return [watchThis, ...watchSources];
      },
      pathKey(path) {
        return getQueryKeyInternal(path);
      },
      stopInjection: () => stopInjection,
    };
    function scope(
      key: TRPCQueryKey,
      link: OperationLink<TRouter, TInput, TOutput>
    ): TRPCLink<AnyTRPCRouter> {
      return () => {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        const prefix = key.flat().join(".");
        return ({ op, next }) => {
          return op.path.startsWith(prefix)
            ? // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
              link({ next, op: op as any })
            : next(op);
        };
      };
    }
  }
}

type GenericE<TInput, TOutput> = Endpoint<"query", TInput, TOutput> &
  Endpoint<"mutation", TInput, TOutput> &
  Endpoint<"subscription", TInput, TOutput>;
type EndpointImplementation<TInput, TOutput> = {
  [K in keyof GenericE<TInput, TOutput>]: GenericE<TInput, TOutput>[K] extends (
    ...args: infer Args
  ) => infer Return
    ? (path: readonly string[], ...args: Args) => Return
    : never;
} & {
  stopInjection: () => StopOptimisticDataInjectionToken;
};
