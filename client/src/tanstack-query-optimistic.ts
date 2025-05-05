import {
  DefaultError,
  FetchQueryOptions,
  matchMutation,
  matchQuery,
  Mutation,
  MutationCache,
  MutationFilters,
  MutationKey,
  MutationObserver,
  MutationObserverOptions,
  MutationObserverResult,
  Query,
  QueryCache,
  QueryClient,
  QueryClientConfig,
  QueryFilters,
  QueryFunction,
  QueryKey,
  QueryOptions,
  QueryState,
  SkipToken,
  useMutation,
  useQuery,
  WithRequired,
} from "@tanstack/react-query";
import { Immer, Immutable } from "immer";

const stopInjection = Symbol("stopInjection");
type StopOptimisticDataInjectionToken = typeof stopInjection;

type AlterQuerySpec<TTargetInput, TTargetOutput> = {
  filter: QueryFilters;
  alter: (
    valuesFromServer: TTargetOutput,
    query: Query<unknown, DefaultError, TTargetOutput>
  ) => TTargetOutput;
};
type WatchMutationSpec<TSourceInput, TSourceOutput> = {
  filter: MutationFilters;
  watch: MutationObserver<TSourceOutput>;
};
type Spec = {
  query: AlterQuerySpec<any, any>[];
  mutation: WatchMutationSpec<any, any>[];
};

function optimisticQueryClient({queryCache, query, mutation, ...options}: QueryClientConfig & Partial<Spec>) {
    return new QueryClient({...options,
        queryCache: decorateQueryCache(queryCache ?? new QueryCache(), query)
    })
}

type UpdateSpec<TSourceInput, TSourceOutput, TTargetInput, TTargetOutput> = {
  to: QueryFilters;
  alter: (
    valuesFromServer: TTargetOutput,
    query: Query<unknown, DefaultError, TTargetOutput>
  ) => TTargetOutput;

  from: MutationFilters;
  update: (mutationVariables: TSourceInput) => MutationObserver<TSourceOutput>;
  updateOptions: MutationObserverOptions<
    TSourceOutput,
    DefaultError,
    TSourceInput
  >;
};

type UpdateConfig<TSourceInput, TSourceOutput, TTargetInput, TTargetOutput> = {
  from: MutationFilters;
  to: QueryFilters;
  onMutate: (mutationVariables: TSourceInput) => {
    match?: QueryFilters;
    inject: (
      valuesFromServer: TTargetOutput,
      mutationResult: MutationObserverResult<
        TSourceOutput,
        DefaultError,
        TSourceInput
      >
    ) => TTargetOutput | StopOptimisticDataInjectionToken;
  };
};

function _makeSpec<TSourceInput, TSourceOutput, TTargetInput, TTargetOutput>(
  config: UpdateConfig<
    TSourceInput,
    TSourceOutput,
    TTargetInput,
    TTargetOutput
  >,
  queryClient: QueryClient
): UpdateSpec<TSourceInput, TSourceOutput, TTargetInput, TTargetOutput> {
  type MutateHooks = ReturnType<typeof config.onMutate>;
  const hooks = new Map<number, MutateHooks>();
  let autoInc = 0;
  let result;
  return {
    from: config.from,
    to: config.to,
    alter(valuesFromServer, query) {
      return valuesFromServer;
    },
    update() {
      return new MutationObserver(queryClient, {
        onMutate(variables) {},
      });
      return mutatePromise.then(
        (success) => {},
        (error) => {}
      );
    },
    updateOptions: {
      onMutate(variables) {
        const mutateHooks = config.onMutate(variables);
        const index = autoInc++;
        hooks.set(index, mutateHooks);
        return { index };
      },
      onError(error, variables, context) {},
    },
  };
}

const test: UpdateConfig<
  { name: string },
  { id: number },
  void,
  { name: string; id: number }[]
> = {
  from: { mutationKey: ["test"] },
  to: { queryKey: ["test"] },
  onMutate(mutationVariables) {
    return {
      inject(valuesFromServer, result) {
        if (
          result.isSuccess &&
          valuesFromServer.find((x) => x.id === result.data.id)
        ) {
          return stopInjection;
        } else {
          return [...valuesFromServer, { ...mutationVariables, id: -1 }];
        }
      },
    };
  },
};

function decorate<T>(init: T, extension: Partial<T>): T {
  return Object.assign({}, init, extension);
}
function decorateQueryCache(
  cache: QueryCache,
  specs: AlterQuerySpec<any, any>[]
): QueryCache {
  return decorate<QueryCache>(cache, {
    build: (client, options, state) =>
      decorateQuery(cache.build(client, options, state), specs),
  });
}
function decorateQuery<TQueryFnData, TError, TData, TQueryKey extends QueryKey>(
  query: Query<TQueryFnData, TError, TData, TQueryKey>,
  specs: AlterQuerySpec<any, any>[]
): Query<TQueryFnData, TError, TData, TQueryKey> {
  return decorate(query, {
    fetch(options, fetchOptions) {
      return specs.reduce(
        (promise, s) =>
          matchQuery(s.filter, query)
            ? promise.then((x) =>
                (s as AlterQuerySpec<any, TData>).alter(
                  x,
                  query as unknown as Query<unknown, DefaultError, TData>
                )
              )
            : promise,
        query.fetch(options, fetchOptions)
      );
    },
  });
}
function decorateMutationCache(
  cache: MutationCache,
  specs: UpdateSpec<any, any, any, any>[]
): MutationCache {
  return decorate<MutationCache>(cache, {
    build: (client, options, state) =>
      decorateMutation(cache.build(client, options, state), specs),
  });
}
function decorateMutation<TData, TError, TVariables, TContext>(
  mutation: Mutation<TData, TError, TVariables, TContext>,
  specs: UpdateSpec<any, any, any, any>[]
): Mutation<TData, TError, TVariables, TContext> {
  return decorate(mutation, {
    execute(variables) {
      return specs.reduce(
        (result, s) =>
          matchMutation(s.from, mutation as Mutation<TData, TError>)
            ? (async () => {
                try {
                  return s.update(variables, result);
                } finally {
                }
              })()
            : result,
        mutation.execute(variables)
      );
    },
  });
}

export function makeOptimisticClient(
  queryClient: QueryClient,
  _specs: (makeSpec: typeof _makeSpec) => UpdateSpec[]
): QueryClient {
  const specs = _specs(_makeSpec);
  return new QueryClient({
    defaultOptions: queryClient.getDefaultOptions(),
    queryCache: decorateQueryCache(queryClient.getQueryCache(), specs),
    mutationCache: decorateMutationCache(queryClient.getMutationCache(), specs),
  });
}
