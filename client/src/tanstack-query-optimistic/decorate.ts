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
import {
  _MutationObserverOptions,
  _MutationObserverResult,
  _Query,
  AnyDef,
} from "./def";

export type TransformQuerySpec<D extends AnyDef> = {
  filter: QueryFilters;
  transform: (
    valuesFromServer: D["target"]["output"],
    query: _Query<D>
  ) => D["target"]["output"];
};
type WatchMutationOptions<D extends AnyDef> = _MutationObserverOptions<D> & {
  onEvent?: (event: _MutationObserverResult<D>) => void;
};

// export function options<D extends Def>(
//   o: WatchMutationOptions<D>
// ): WatchMutationOptions<D> {
//   return o;
// }

export type WatchMutationSpec<D extends AnyDef> = {
  filter: MutationFilters;
  watch: () => WatchMutationOptions<D>;
};
export type Spec = {
  transformQuery: TransformQuerySpec<AnyDef>[];
  watchMutation: WatchMutationSpec<AnyDef>[];
};6

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
  specs: TransformQuerySpec<AnyDef>[]
): QueryCache {
  return decorate(cache, {
    build: (client, options, state) =>
      decorateQuery(cache.build(client, options, state), specs),
  });
}
function decorateQuery<D extends AnyDef>(
  query: _Query<D>,
  specs: TransformQuerySpec<D>[]
): _Query<D> {
  return decorate(query, {
    fetch(options, fetchOptions) {
      return specs.reduce(
        (promise, s) =>
          matchQuery(s.filter, query)
            ? promise.then((x) => s.transform(x, query))
            : promise,
        query.fetch(options, fetchOptions)
      );
    },
  });
}
function decorateMutationCache(
  cache: MutationCache,
  specs: WatchMutationSpec<AnyDef>[]
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
