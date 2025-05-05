import {
  DefaultError,
  matchMutation,
  matchQuery,
  Mutation,
  MutationCache,
  MutationFilters,
  MutationObserver,
  MutationObserverOptions,
  MutationObserverResult,
  Query,
  QueryCache,
  QueryClient,
  QueryClientConfig,
  QueryFilters,
  QueryKey,
} from "@tanstack/react-query";

export type TransformQuerySpec<TTargetInput, TTargetOutput> = {
  filter: QueryFilters;
  transform: (
    valuesFromServer: TTargetOutput,
    query: Query<unknown, DefaultError, TTargetOutput>
  ) => TTargetOutput;
};
type WatchMutationOptions<TSourceInput, TSourceError, TSourceOutput, TSourceContext> = MutationObserverOptions<
TSourceOutput,
TSourceError,
TSourceInput,
TSourceContext
> & {
onEvent?: (
  event: MutationObserverResult<
    TSourceOutput,
    TSourceError,
    TSourceInput,
    TSourceContext
  >
) => void;
};


export function options<
  TData,
  TError,
  TVariables,
  TContext
>(
  o: WatchMutationOptions<TData, TError, TVariables, TContext>
): WatchMutationOptions<TData, TError, TVariables, TContext> {
  return o;
}

export type WatchMutationSpec<TSourceInput, TSourceOutput> = {
  filter: MutationFilters;
  watch: () => WatchMutationOptions<TSourceInput, any, TSourceOutput, any>
};
export type Spec = {
  transformQuery: TransformQuerySpec<any, any>[];
  watchMutation: WatchMutationSpec<any, any>[];
};

export function decorateClient(queryClient: QueryClient, spec: Spec) {
  return new QueryClient({
    defaultOptions: queryClient.getDefaultOptions(),
    queryCache: decorateQueryCache(
      queryClient.getQueryCache(),
      spec.transformQuery ?? []
    ),
    mutationCache: decorateMutationCache(
      queryClient.getMutationCache(),
      spec.watchMutation ?? []
    ),
  });
}

function decorate<T extends object>(init: T, extension: Partial<T>): T {
  Object.setPrototypeOf(extension, init);
  return extension as T;
}

function decorateQueryCache(
  cache: QueryCache,
  specs: TransformQuerySpec<any, any>[]
): QueryCache {
  return decorate(cache, {
    build: (client, options, state) =>
      decorateQuery(cache.build(client, options, state), specs),
  });
}
function decorateQuery<TQueryFnData, TError, TData, TQueryKey extends QueryKey>(
  query: Query<TQueryFnData, TError, TData, TQueryKey>,
  specs: TransformQuerySpec<any, any>[]
): Query<TQueryFnData, TError, TData, TQueryKey> {
  return decorate(query, {
    fetch(options, fetchOptions) {
      return specs.reduce(
        (promise, s) =>
          matchQuery(s.filter, query)
            ? promise.then((x) =>
                (s as TransformQuerySpec<any, TData>).transform(
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
  specs: WatchMutationSpec<any, any>[]
): MutationCache {
  return decorate<MutationCache>(cache, {
    build: (client, options, state) => {
      const mutation = cache.build(client, options, state);
      for (const spec of specs) {
        if (matchMutation(spec.filter, mutation as Mutation<any, any>)) {
          mutation.addObserver(new MutationObserver(client, spec.watch()));
        }
      }
      return mutation;
      // return decorateMutation(mutation, specs);
    },
  });
}

const dec = decorateClient(new QueryClient(), {
  transformQuery: [
    {
      filter: {
        queryKey: ["asdf"],
      },
      transform(valuesFromServer, query) {
        return `${valuesFromServer}`;
      },
    },
  ],
  watchMutation: [],
});

(async () => {
  const result = await dec.fetchQuery<number, DefaultError, string>({
    queryKey: ["asdf"],
    queryFn: () => Promise.resolve(5),
  });
  console.log({ result });
})();
