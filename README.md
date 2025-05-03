# A demo of an idea for implementing optimistic updates using TRPC links

You can see the demo live here: [![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/JonLoesch/trpc-link-demo)


This application uses [TRPC](https://trpc.io/) with an adapter for [TanStack React Query](https://tanstack.com/query/latest/docs/framework/react/overview); it's based on the [minimal react TRPC example, here](https://github.com/trpc/trpc/tree/main/examples/minimal-react).  The idea is to showcase an idea I have (not yet fully implemented or cleaned up).  The idea is:
- There is [a sample TRPC schema](server/index.ts), with an artifical delay built in (3 to 5 seconds added to each TRPC request)
- There is [a single file](client/src/optimistic-updates.ts) where we defined some optimistic update logic.  In particular:
  - we assume that `thread.create` will succeed and optimistically adjust `thead.all`
  - we assume that `thread.delete` will succeed and optimistically adjust `thead.all`
  - we assume that `post.create` will succeed and optimistically adjust `post.allInThread`
  - we assume that `post.delete` will succeed and optimistically adjust `post.allInThread`
- All this is done in a typesafe way, using a helper function `createTRPCLinkProxy`.  The [source code to provide that function](client/src/trpc-link.ts) is super hacky and just a proof-of-concept right now so don't read too much into its implementation.  It needs to be seriously cleaned up if this concept goes forward.
- We implement the optimistic oupdate logic across the whole app, separated from the actual UI components.  it is injected into the [links](https://trpc.io/docs/client/links) of the TRPC client at instantiation, so that any time we call the affected procedures, we will benefit from the optimistic caching logic implicitly.


## Interface
Here's an example of how the interface to the library currently is:
```
import { createTRPCLinkProxy } from "./trpc-link";
const trpcLink = createTRPCLinkProxy<AppRouter>(queryClient);


    //
    // inject results into this TRPC query:
    //
    ...trpcLink.posts.allInThread.optimisticCache(
        [], // this is used if the injection happens before we fetch even a single value from the server. -- probably we don't need this?
        [
          //
          // inject results by hooking into this TRPC mutation:
          //
          trpcLink.posts.delete.optimisticDataSource({
            queryParameters: (input) => ({ threadId: input.threadId }), // the parameters to the `posts.allInThread` query
            injectNewData( // this gets added to an internal bag of functions that alter the apparent value `posts.allInThread`
              fromServer, // the return type of `posts.allInThread`
              toRemove, // the input type of `posts.delete`
              mutationComplete // the return `posts.delete` (or undefined if it's still in flight.  probably this should be a more fully formed mutation state object?)
            ) {
              if (
                //
                // if the mutation has finished and we can see that the toRemove id is gone from the list,
                // then we can cancel this injection.  By returning the stopInjection() token, this `injectNewData` function will be removed from the bag of functions altering the return value.
                //
                mutationComplete &&
                !fromServer.find((x) => x.id === toRemove.id)
              ) {
                return trpcLink.stopInjection();
              } else {
                // until 
                return fromServer.filter((x) => x.id !== toRemove.id);
              }
            },
          }),

          // ... you can link multiple optimisticDataSource calls to a single optimisticCache call.
          // which seemed like a good idea at the time but I'm not sure it really helps
        ]
  )
```

## Auto-cache handling behaviour
The client application is responsible for having logic to optimistically inject (or remove) fake values from the server queries.  Since the client application is the one with the concrete typing information, I don't think there's any way around this (although there's maybe some room for some helpful handlers of common cases like adding to or removing from a simple array).  The library handles:
- the typing of the values (everything in the above code block has proper typing information inferred from the TRPC interface)
- hooking into TRPC's link interface with the proper query keys
- updating TanStack's query data automatically.
  - on a new mutation, new values are immediately optimistically injected without a refresh
  - on a mutation error, the injection is automatically cancelled
  - on cancelling an injection for any reason, the existing query value is restored (without needing to refetch the query).  All injections are immutable functions and this library also holds the latest unaltered value from the server
    - TODO type enforce immutable function.  Probably use `immer`
    - TODO storing the latest unaltered value while `QueryCache` stores the latest altered value ... is there a way to fix this overlap of functionality?


## Playing around

```bash
npm i
npm run dev
```

Try editing the ts files to see the type checking in action :)

## Building

```bash
npm run build
npm run start
```
