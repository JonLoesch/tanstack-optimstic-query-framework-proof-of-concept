import {
  MutationObserver,
  MutationObserverIdleResult,
  MutationObserverOptions,
  MutationObserverResult,
  Query,
  useMutation,
} from "@tanstack/react-query";

export type AnyDef = SpecificDef<any, any, any, any, any, any, any, any, any>;
export type SpecificDef<
  TSourceInput,
  TSourceError,
  TSourceOutput,
  TSourceContext,
  TTargetInput,
  TTargetError,
  TTargetOutput,
  TTargetOutputPreTransform,
  TTargetQueryKey
> = {
  source: {
    input: TSourceInput;
    error: TSourceError;
    output: TSourceOutput;
    context: TSourceContext;
  };
  target: {
    input: TTargetInput;
    error: TTargetError;
    output: TTargetOutput;
    outputPreTransform: TTargetOutputPreTransform;
    queryKey: TTargetQueryKey;
  };
};

type Adjust<
  D extends AnyDef,
  K1 extends keyof D,
  K2 extends keyof D[K1],
  Replace
> = Omit<D, K1> & Record<K1, Omit<D[K1], K2> & Record<K2, Replace>>;
export type AdjustTargetOutput<D extends AnyDef, Replace> = Adjust<
  D,
  "target",
  "output",
  Replace
>;

export type _Query<D extends AnyDef> = Query<
  D["target"]["outputPreTransform"],
  D["target"]["error"],
  D["target"]["output"],
  D["target"]["queryKey"]
>;

export type _MutationObserverOptions<D extends AnyDef> =
  MutationObserverOptions<
    D["source"]["output"],
    D["source"]["error"],
    D["source"]["input"],
    D["source"]["context"]
  >;

export type _MutationObserverResult<D extends AnyDef> = MutationObserverResult<
  D["source"]["output"],
  D["source"]["error"],
  D["source"]["input"],
  D["source"]["context"]
>;

export type _MutationObserverIdleResult<D extends AnyDef> =
  MutationObserverIdleResult<
    D["source"]["output"],
    D["source"]["error"],
    D["source"]["input"],
    D["source"]["context"]
  >;

export type _MutationObserver<D extends AnyDef> = MutationObserver<
  D["source"]["output"],
  D["source"]["error"],
  D["source"]["input"],
  D["source"]["context"]
>;
