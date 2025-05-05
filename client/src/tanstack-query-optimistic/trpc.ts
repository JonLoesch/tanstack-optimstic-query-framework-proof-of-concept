import { MutationKey, QueryClient, QueryKey } from "@tanstack/react-query";
import { trpc } from "../utils/trpc";
import { makeSpec, OptimisticConfig, stopInjection } from "./makeSpec";
import { decorateClient } from "./decorate";



type ReturnVoid<T extends (...args: any) => any> = (
  ...params: Parameters<T>
) => void;
type BuilderArgsOptimisticData<TSourceInput, TSourceOutput, TTargetInput, TTargetOutput> = {
    from: {
        '~types': {
            'input': TSourceInput;
            'output': TSourceOutput;
        };
        'mutationKey': () => MutationKey;
    };
    to: {
        '~types': {
            'input': TTargetInput;
            'output': TTargetOutput;
        };
        'queryKey': () => QueryKey;
    };
    queryParameters: (mutationParameters: TSourceInput) => TTargetInput;
} & Pick<OptimisticConfig<TSourceInput, TSourceOutput, TTargetInput, TTargetOutput>, 'inject'>;

interface Builder {
  optimisticData<
  TSourceInput,
  TSourceOutput,
  TTargetInput,
  TTargetOutput
>(config: BuilderArgsOptimisticData<TSourceInput, TSourceOutput, TTargetInput, TTargetOutput>): void
}

export function createOptimisticClient(factory: (builder: Builder) => void, baseClient?: QueryClient): QueryClient {
    const base = baseClient ?? new QueryClient();
      const spec = makeSpec(builder => {
        factory({
            optimisticData<TSourceInput, TSourceOutput, TTargetInput, TTargetOutput>(config: BuilderArgsOptimisticData<TSourceInput, TSourceOutput, TTargetInput, TTargetOutput>) {
                builder.optimisticData<TSourceInput, TSourceOutput, TTargetInput, TTargetOutput>({
                    inject: config.inject,
                    from: config.from.mutationKey(),
                    to: {
                        prefix: (config.from as unknown as {'pathKey': () => QueryKey}).pathKey(),
                    }
                }, base);
            },
        });
      });
      return decorateClient(base, spec);
}

createOptimisticClient(builder => {
    builder.optimisticData({
        from: trpc.threads.create,
        to: trpc.threads.all,
        queryParameters: () => undefined,
        inject(valuesFromServer, mutation) {
            if (mutation.isSuccess && valuesFromServer.find(x => x.id === mutation.data.id)) {
                return stopInjection;
            } else {
                return [...valuesFromServer, {...mutation.variables, id: -1}];
            }
        },
    })
})

// return [
//     ...trpc.threads.all.optimisticCache(
//       [],
//       [
//         trpcLink.threads.create.optimisticDataSource({
//           queryParameters: () => undefined,
//           injectNewData(fromServer, newData, mutationComplete) {
//             if (
//               mutationComplete &&
//               fromServer.find((x) => x.id === mutationComplete.id)
//             ) {
//               return trpcLink.stopInjection();
//             } else {
//               return [...fromServer, { ...newData, id: -1 }];
//             }
//           },
//         }),
//         trpcLink.threads.delete.optimisticDataSource({
//           queryParameters: () => undefined,
//           injectNewData(fromServer, toRemove, mutationComplete) {
//             if (
//               mutationComplete &&
//               !fromServer.find((x) => x.id === toRemove.id)
//             ) {
//               return trpcLink.stopInjection();
//             } else {
//               return fromServer.filter((x) => x.id !== toRemove.id);
//             }
//           },
//         }),
//       ]
//     ),