import {
  DefaultError,
  FetchQueryOptions,
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
  QueryOptions,
  QueryState,
  SetDataOptions,
  WithRequired,
} from "@tanstack/react-query";
import {
  _MutationObserver,
  _MutationObserverOptions,
  _MutationObserverResult,
  _Query,
  AnyDef,
} from "./def";

export const stopInjection = Symbol("stopInjection");
type MutationCacheNotifyEvent = Parameters<MutationCache["notify"]>[0];

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  return map.has(key) ? map.get(key)! : map.set(key, create()).get(key)!;
}

export class InjectableQueryClient extends QueryClient {
  //   #injectionAutoincrement = 0;
  //   #activeInjections = new Map<
  //     number,
  //     {
  //       filter: QueryFilters;
  //       transform: <T>(data: T) => T | StopOptimisticDataInjectionToken;
  //     }
  //   >();
  #injections = new GridBag<
    Query,
    {
      transformData: <T>(data: T) => T | typeof stopInjection;
      emptyDefaultIfTransformBeforeServerValue: any;
      hasStopped: boolean;
    },
    string
  >((q) => q.queryHash);
  #unalteredValues = new Map<string, unknown>();
  injectQueryData<Data>(
    filters: QueryFilters,
    emptyDefaultIfTransformBeforeServerValue: Data,
    makeHandler: (query: Query) => {
      transformData: (data: Data) => Data | typeof stopInjection;
    }
  ) {
    const refresh = () => {
      this.#injections.deferCleanupTillEnd(() => {
        for (const query of this.getQueryCache().findAll(filters)) {
          this.setQueryData(query.queryKey, (lastData: Data) => {
            const lastUnaltered = this.#unalteredValues
              .set(
                query.queryHash,
                this.#unalteredValues.get(query.queryHash) ??
                  lastData ??
                  emptyDefaultIfTransformBeforeServerValue
              )
              .get(query.queryHash);
            return this.#transformValue(query, lastUnaltered);
          });
        }
      });
    };

    const unsubscribe = this.#injections.createLayer(
      (query) => {
        if (matchQuery(filters, query)) {
          return () => {
            const handler = makeHandler(query);
            return {
              transformData: handler.transformData as <T>(
                data: T
              ) => T | typeof stopInjection,
              hasStopped: false,
              emptyDefaultIfTransformBeforeServerValue:
                emptyDefaultIfTransformBeforeServerValue,
            };
          };
        } else {
          return noMatch;
        }
      },
      () => {}
    );

    const invalidateAndRefetch = () => {
      this.invalidateQueries(filters);
    };

    return { refresh, unsubscribe, invalidateAndRefetch };
  }

  #transformValue<T>(query: Query, unaltered: T): T {
    let isAltered = false;
    let value = unaltered;

    for (const [handler, extra] of this.#injections.active(query)) {
      if (handler.hasStopped) continue;
      const newValue = handler.transformData(value);
      if (newValue === stopInjection) {
        handler.hasStopped = true;
        extra.cleanupLayer((layer) =>
          layer.active.values().every((x) => x.hasStopped)
        );
      } else {
        value = newValue;
        isAltered = true;
      }
    }

    if (isAltered) {
      this.#unalteredValues.set(query.queryHash, unaltered);
    } else {
      this.#unalteredValues.delete(query.queryHash);
    }

    return value;
  }

  #mutations = new GridBag<
    Mutation,
    {
      onChange: (result: MutationObserverResult<any, any, any, any>) => void;
    },
    number
  >((m) => m.mutationId);
  watchMutationEvents<T>(
    filters: MutationFilters,
    makeHandler: (mutation: Mutation) => {
      onChange: (result: MutationObserverResult<any, any, T, any>) => void;
      unsubscribe?: () => void;
    }
  ): {
    unsucscribe: () => void;
  } {
    const allCleanups: Array<() => void> = [];
    return {
      unsucscribe: this.#mutations.createLayer(
        (mutation) => {
          if (matchMutation(filters, mutation)) {
            return () => {
              const handler = makeHandler(mutation);
              allCleanups.push(() => handler.unsubscribe?.());
              return { onChange: handler.onChange };
            };
          } else {
            return noMatch;
          }
        },
        () => allCleanups.forEach((c) => c())
      ),
    };
  }

  onMutationUpdate(event: MutationCacheNotifyEvent) {
    console.log(
      "mutation event",
      event.type,
      event,
      event.type === "updated" && {
        state: event.mutation.state,
        status: event.mutation.state.status,
      }
    );
    if (event.type === "updated") {
      if (event.mutation.state.status === "error") {
        console.error(event.mutation.state.error);
      }
      for (const [handler] of this.#mutations.active(event.mutation)) {
        const state = {
          ...event.mutation.state,
          isPending: event.mutation.state.status === "pending",
          isSuccess: event.mutation.state.status === "success",
          isError: event.mutation.state.status === "error",
          isIdle: event.mutation.state.status === "idle",
        } as MutationObserverResult;
        handler.onChange(state);
      }
    }
  }

  constructor(...options: ConstructorParameters<typeof QueryClient>) {
    super(...options);

    this.getMutationCache().subscribe((event) => {
      this.onMutationUpdate(event);
    });

    monkeyPatch(
      QueryCache.prototype,
      InjectableQueryCache.prototype,
      this.getQueryCache()
    )!.transformer = <Data>(query: Query, data: Data) =>
      this.#transformValue(query, data);
  }
}

class InjectableQueryCache extends QueryCache {
  transformer: <T>(query: Query, data: T) => T = undefined as any;
  add(query: Query): void {
    monkeyPatch(
      Query.prototype,
      InjectableQuery.prototype,
      query
    )!.transformer = this.transformer;
    return super.add(query);
  }
}
class InjectableQuery extends Query {
  transformer: <T>(query: Query, data: T) => T = undefined as any;
  setData(newData: any, options?: SetDataOptions & { manual: boolean }) {
    if (options?.manual !== true) {
      newData = this.transformer(this, newData);
    }
    return super.setData(newData, options);
  }
}

function monkeyPatch<Parent extends object, Child extends object>(
  parentPrototype: Parent,
  childPrototype: Child,
  object: Parent
) {
  if (
    parentPrototype.isPrototypeOf(object) &&
    Object.getPrototypeOf(childPrototype) === parentPrototype
  ) {
    Object.setPrototypeOf(object, childPrototype);
    return object as unknown as Child;
  }
}

interface Inj {
  inject: (f: QueryFilters, onMatch: (q: Query) => {}) => () => void;
  refresh: (f: QueryFilters) => void;
  invalidate: (f: QueryFilters) => void;
  watch: (f: MutationFilters, onMatch: (m: Mutation) => {}) => () => void;
}

const noMatch = Symbol("noMatch");
type Layer<Item, Handlers, K extends string | number | symbol> = {
  makeHandlers: (obj: Item) => typeof noMatch | (() => Handlers);
  onCleanup: () => void;
  active: Map<K, Handlers>;
};
type CleanupParams<Item, Handlers, K extends string | number | symbol> = {
  index: number;
  isOkToCleanup: (layer: Layer<Item, Handlers, K>) => boolean;
};
class GridBag<Item, Handlers, K extends string | number | symbol> {
  constructor(private readonly hashFunc: (k: Item) => K) {}
  #inc = 0;
  #all = new Map<number, Layer<Item, Handlers, K>>();
  createLayer(
    makeHandlers: Layer<Item, Handlers, K>["makeHandlers"],
    onCleanup: () => void
  ): () => void {
    const index = this.#inc++;
    this.#all.set(index, {
      makeHandlers,
      onCleanup,
      active: new Map(),
    });
    return () => this.#all.delete(index);
  }
  #cleanupNow({ index, isOkToCleanup }: CleanupParams<Item, Handlers, K>) {
    if (this.#all.has(index) && isOkToCleanup(this.#all.get(index)!)) {
      this.#all.delete(index);
    }
  }
  #deferredCleanups?: Array<CleanupParams<Item, Handlers, K>>;
  #cleanupEventually(params: CleanupParams<Item, Handlers, K>) {
    if (this.#deferredCleanups) {
      this.#deferredCleanups.push(params);
    } else {
      this.#cleanupNow(params);
    }
  }
  deferCleanupTillEnd(proc: () => void) {
    if (this.#deferredCleanups) {
      proc();
    } else {
      try {
        this.#deferredCleanups = [];
        proc();
        this.#deferredCleanups.forEach((p) => this.#cleanupNow(p));
      } finally {
        this.#deferredCleanups = undefined;
      }
    }
  }
  *active(obj: Item): Iterable<
    [
      Handlers,
      {
        cleanupLayer: (
          isOkToCleanup: CleanupParams<Item, Handlers, K>["isOkToCleanup"]
        ) => void;
      }
    ]
  > {
    for (const [index, potential] of this.#all.entries()) {
      const m = potential.makeHandlers(obj);
      if (m === noMatch) continue;
      yield [
        getOrCreate(potential.active, this.hashFunc(obj), m),
        {
          cleanupLayer: (isOkToCleanup) =>
            this.#cleanupEventually({ index, isOkToCleanup }),
        },
      ];
    }
  }
}
