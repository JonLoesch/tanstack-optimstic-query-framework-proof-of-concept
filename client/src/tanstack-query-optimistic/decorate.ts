import {
  DefaultError,
  hashKey,
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
  _MutationObserver,
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
type WatchMutationOptions<D extends AnyDef> = (
  event: _MutationObserverResult<D>
) => void;

export type WatchMutationSpec<D extends AnyDef> = {
  filter: MutationFilters;
  watch: () => WatchMutationOptions<D>;
};
export type Spec = {
  transformQuery: TransformQuerySpec<AnyDef>[];
  watchMutation: WatchMutationSpec<AnyDef>[];
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
  return new Proxy(init, {
    get(target, prop, receiver) {
      const override = extension[prop as keyof T];
      if (override) return override;
      const value = (target as any)[prop];
      if (value instanceof Function) {
        return function (this: any, ...args: any[]) {
          return value.apply(this === receiver ? target : this, args);
        };
      }
      return value;
    },
  });
}

function decorateQueryCache(
  cache: QueryCache,
  specs: TransformQuerySpec<AnyDef>[]
): QueryCache {
  return decorate(cache, {
    build: (client, options, state) => {
      return decorateQuery(cache.build(client, options, state), specs);
    },
  });
}
function decorateQuery<D extends AnyDef>(
  query: _Query<D>,
  specs: TransformQuerySpec<D>[]
): _Query<D> {
  return decorate(query, {
    setData(newData, options) {
      if (options?.manual !== true) {
        query.setData(
          specs.reduce((v, s) => {
            return matchQuery(s.filter, query) ? s.transform(v, query) : v;
          }, newData),
          options
        );
      }
    },
    // fetch(options, fetchOptions) {
    //   return specs.reduce((promise, s) => {
    //     return matchQuery(s.filter, query)
    //       ? promise.then((x) => s.transform(x, query))
    //       : promise;
    //   }, query.fetch(options, fetchOptions));
    // },
  });
}
function decorateMutationCache(
  cache: MutationCache,
  specs: WatchMutationSpec<AnyDef>[]
): MutationCache {
  const watchLookup = specs.map(
    () =>
      new Map<
        number,
        {
          observer: _MutationObserver<AnyDef>;
          onEvent: WatchMutationOptions<AnyDef>;
        }
      >()
  );
  cache.subscribe((event) => {
    if (event.type === "observerAdded") {
      specs.forEach((spec, index) => {
        if (matchMutation(spec.filter, event.mutation)) {
          watchLookup[index].set(event.mutation.mutationId, {
            onEvent: spec.watch(),
            observer: event.observer,
          });
        }
      });
    } else if (event.type === "observerRemoved") {
      specs.forEach((spec, index) => {
        if (matchMutation(spec.filter, event.mutation)) {
          watchLookup[index].delete(event.mutation.mutationId);
        }
      });
    }
    if (event.type === "updated") {
      specs.forEach((spec, index) => {
        if (matchMutation(spec.filter, event.mutation)) {
          const newLocal = watchLookup[index].get(event.mutation.mutationId);
          if (newLocal?.observer) {
            newLocal.onEvent?.(newLocal.observer.getCurrentResult());
          }
        }
      });
    }
  });
  return cache;
  //   return decorate<MutationCache>(cache, {
  //     build: (client, options, state) => {
  //       const mutation = cache.build(client, options, state);
  //       for (const spec of specs) {
  //         if (matchMutation(spec.filter, mutation as Mutation<any, any>)) {
  //           const options = spec.watch();
  //           const observer = new MutationObserver(client, options);
  //           mutation.addObserver(observer);
  //           if (options.onEvent) {
  //             console.log("subscribe");
  //             observer.subscribe(options.onEvent);
  //           }
  //         }
  //       }
  //       return mutation;
  //       // return decorateMutation(mutation, specs);
  //     },
  //   });
}
