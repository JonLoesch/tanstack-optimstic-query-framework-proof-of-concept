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
  options,
  Spec,
  TransformQuerySpec,
  WatchMutationSpec,
} from "./decorate";



export const stopInjection = Symbol("stopInjection");
type StopOptimisticDataInjectionToken = typeof stopInjection;

interface SpecBuilder<B> {
    builder: B,
    spec(): Spec,
}

export function runSpecBuilder<B>(
  constructor: (baseClient: QueryClient) => SpecBuilder<B>
): (
  factory: (builder: B) => void,
  baseClient?: QueryClient
) => QueryClient {
  return (factory, baseClient) => {
    const base = baseClient ?? new QueryClient();
    const builder = constructor(base);
    factory(builder.builder);
    return decorateClient(base, builder.spec());
  };
}
