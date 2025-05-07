# TanStack Query / Optimistic Updates -- A proof-of-concept framework

### Disclaimer
So, first up:  This idea is half baked and has many problems in the implementation (among other things, errors in the network stack are not properly propogated through and kind of just swallowed).  So don't use it in any real system.  You've been warned.

That said I *believe* most of the problems here are due to "I haven't done that yet", not due to any sort of structural impossibility.  If this is something that you think would be helpful for your project, let me know and I can start trying to build it out fully.  That's the whole point of this demo, to gauge community interest.

### My Questions
There are a couple questions I am trying to answer:
- Is this similar to something that already exists?  I looked and couldn't find anything but maybe I'm dumb.
- Is this something that is of any interest to people?  How many people actually write detailed optimistic update logic for their applications, and how often is that an important part of application architecture?
- Does the interface I've laid out below make sense to people?  Are there better ways of organizing the code, what would make sense for the most people's application structures?
- Is this the right place for this?

The biggest question I am trying to answer is:

> Should I pursue this as an optional componion module for tanstack query?  Or as a fork/PR?  Or at all?

I'm hoping that discussion around this topic can answer some of these questions for me.

# The problem statement
Optimistic updates are the idea of having the UI update before it recieves final confirmation from the server.  There are a few patterns for this using TanStack Query as a library, but I'll be using [this example](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates#updating-a-list-of-todos-when-adding-a-new-todo) for my discussion.  This is the code sample, for reference:

```
const queryClient = useQueryClient()

useMutation({
  mutationFn: updateTodo,
  // When mutate is called:
  onMutate: async (newTodo) => {
    // Cancel any outgoing refetches
    // (so they don't overwrite our optimistic update)
    await queryClient.cancelQueries({ queryKey: ['todos'] })

    // Snapshot the previous value
    const previousTodos = queryClient.getQueryData(['todos'])

    // Optimistically update to the new value
    queryClient.setQueryData(['todos'], (old) => [...old, newTodo])

    // Return a context object with the snapshotted value
    return { previousTodos }
  },
  // If the mutation fails,
  // use the context returned from onMutate to roll back
  onError: (err, newTodo, context) => {
    queryClient.setQueryData(['todos'], context.previousTodos)
  },
  // Always refetch after error or success:
  onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
})
```

This implementation works, and it's relatively easy to understand the data flow.  But I have two fundamental problems with this approach:
1. This means that the logic for optimistic updates lives co-located inside the UI.  In my opinion, this logic is more directly coupled with the shape of your API, and the interdependencies between which POST methods will cause changes in other GET methods, etc...  Having the logic for these (potentially much more intricate) data updates mixed in with the logic for UI updates seems like a recipe for complexity to me.  [Single responsibility](https://en.wikipedia.org/wiki/Single-responsibility_principle) and all that.
2. I also think that the above logic is not quite correct with regards to all possible race conditions.  I'll elaborate more on this [below](#race-conditions)

### Alternatives
There are a couple possible solutions to #1 that are not nearly as invasive or complex as what I've done here, so lets talk about those alternatives:
- Write a custom hook (e.g. `useUpdateTodo`) that encapsulates everything about the mutation: the parameters of the mutation, the endpoint to call, the mutation key (if any), cache/retry parameters (if any).  This can of course include event handlers like `onMutate`, `onError`, `onSuccess`, and `onSettled`, which means you can implement the above logic in a central place.
  - It does mean writing a separate hook function for each endpoint you want to encapsulate which is kind of a bit messy in terms of namespace pollution to me, but I suppose that's a minor issue
  - It does also mean that your encapsulations have to be aware of the concept of react hooks (or whatever flavor UI abstraction).
    - Why does the logic that has to do with tweaking cache data from the API have any knowledge of your frontend architecture?  If I have local state or effects associated with that `useUpdateTodo`, that means I'm even closer tying it to react
    - Why should I worry about whether my `useUpdateTodo` is reference stable on rerenders?  Why should I even be worrying about rerenders at all inside of `useUpdateTodo`?
- If you're using another tool to build your mutation option objects (as I am with TRPC), then you might be able to hook into that third party tool to specify the handlers for you (`onMutate`, `onError` etc...)
  - This is obviously dependent on what layer or tool you are using on top of TanStack Query.  But it's also needing to interface directly with the TanStack Query Cache.  So you're interacting somwhat deeply with two related-but-not-the-same levels of your application stack.  Which is ... not that big a deal from a practical point of view, but seems distasteful to me.
- Use [QueryClient.setMutationDefaults](https://tanstack.com/query/latest/docs/reference/QueryClient/#queryclientsetmutationdefaults)  -- This allows you to specify once at an application-wide level, what optimistic update logic will apply to which mutation keys.
  - It means you need to use mutation keys, but IMO this is no big deal.  (I may be biased because I'm using TanStack Query through TRPC, so I've always got autogenerated keys anyway)
  - For reference, here is how you would implement the above:
    ```
    // Run once near the root of your application:
    const queryClient = useQueryClient()
    queryClient.setMutationDefaults(['addTodo'], {
      mutationFn: updateTodo,
      // When mutate is called:
      onMutate: async (newTodo) => {
        // ... exactly the same as the above code ...
      },
      onError: // ... also the same
      onSettled: // ... also the same
    });

    // to mutate
    useMutation({
      mutationKey: ['addTodo'],
    })
    ```
  - The fact that the interface is basically identical to the `useMutation` options is also of incredible practical value, in terms of being able to really quickly port code from global options for everywhere in your application this is used, to an ad-hoc basis, or vice versa.

### My idea
I ended up writing a few wrapper methods for this problem myself.  Throughout the process I noticed that a core important concept is immutable updates, specifically functions with signatures kind like `(data: Immutable<T>) => Immutable<T>`.  This makes sense, in order to update a value inline (and invisibly) to a component expecting a certain data shape from the server, you can't swap out the signature and expect things to still work.  And immutability comes from the fact that immutability is widely used for change control / rerender triggers in UI frameworks.  So my idea was, if the optimistic update logic needs to know how to provide an immutable data map functiona nyway, why not use that as the core abstraction?  What if every mutation knew which query (or queries) it should optimistically update, and knew how to provide an immutable function to do so?  Then each query could maintain a cache of not only the latest value, but **two latest values, one direct from the server, and one altered**.  The altered value can be updated locally whenever an immutable mapper gets added to or removed from the list, and the cache of the server doesn't need to change until a full `invalidate`.  This is how that logic looks below:

```
queryClient = new InjectableQueryClient();
  // This is a subclass of QueryClient with some extra functionality.
  // It has a helper method to watch mutation state (something you can do using the existing client)
  // And it has helper methods to inject immutable data maps into the query flow as a fetch postprocess step
    // ^ (something I had to alter prototypes and user Proxys to do and it's very hacky.  It's a proof of concept though)

_attachOptimisticFunctionality(queryClient).optimisticData({
  from: { mutationKey: ["addTodo"] },
  to: (mutation) => ({ queryKey: ["todos"] }),
    // the (mutation) => can help in situations where you are trying to update a query whose path has dynamic components.  Doesn't matter here.
  inject: () => (valueFromServer, mutationState) => {
    // Don't stop injection until the mutation is complete AND we the value in the latest value. 
    // This handles race conditions if a query is in flight while the mutation completes.  Since
    // there is no way to know from the timing alone whether the query includes the mutation value,
    // we have to leave it up to application concern
    if (
      mutationState.isSuccess &&
      valueFromServer.find((x: any) => x.id === mutationState.data.id)
    ) {
      return stopInjection;
    } else {
      // Optimistically update to the new value
      return [...valueFromServer, mutationState.data]
    }
  },
  emptyDefaultIfMutationBeforeQuery: [], // ignore this for now.  This is a wart of the current design and I want to get rid of it.
});
```

In my opinion, this is about as close to minimal you can make the interface.  You can layer as many injections on top of each other as you need, if you need to have multiple queries affected by the same mutation, or multiple mutations affecting the same query.  You can organize or group those however makes sense for you in your application as long as you call all the injections when you create the query client.  You need to speficy the appropriate query and mutation keys (really [any filters work](https://tanstack.com/query/latest/docs/framework/react/guides/filters)) and the logic for an immutable data mapper, and the framework handles the rest:
- Maintaining two cached versions of the data, the altered data to be provided to the client, and the unaltered one from the server
  - (the second cache is actually empty most of the time until a mutation fires and there is an active data injection, since if there are no data mappers applying to a query (as in 99% of the time) then there is no reason to have two copies of the data.  I did this as a garbage collection optimization, not sure if it actually matters though)
- Applying the changes to the query cache when the mutation fires up for the first time
- Cancelling the changes if the mutation errors
- Causing a full refresh of the query when the mutation succeeds
  - Maintaining the optimistic data injection until the real value comes back, although detection of "when the real value comes back" is left up to the application.

#### Race conditions
My approach is not a one-to-one map with the previously described logic in event handlers (`onMutate`, `onError`, `onSettled`).  But I think my logic is actually better? (I'm far from sure)  The pattern of having immutable data mappers means that we handle scenarios correctly that the previous logic might not.  These are admittedly edge cases and may or may not even be possible depending on the exact UI.
- The `onMutate` handler above would do a `cancelQueries` call to not have in flight queries clobber over existing data.  This is not a problem for us since if a mutation goes out and adds an immutable mapper while a fetch is in flight, then when the fetch comes back it will go throuigh that immutable mapper.
- The scenario where a mutation is fired and THEN a query is fired but the query comes back before the mutation, that (AFAIK) isn't handled properly by the above `onMutate` handler since it only cancels current queries, doesn't block any.  Again this isn't an issue for us since we're basically applying a postprocess mapper at the end of fetchs that come in.  And since it's all non-async code and JS is single threaded, there's no race conditions there
- If two mutates fire and then the first one fails but the second goes through, this framework will continue to manage the optimistic injection of the second mutation independently from the first.  In the `onMutate` handler, since the context is just storing a backup of the previous state, this will not work correctly.

### Two solutions

I started out trying to solve problem #1 (the colocation of UI concerns and optimistic cache concerns).  I ended up kind of accidentally stumbling into problem #2 and a solution for it (the fact that the existing mutation-event-handler approach is not robust enough in all situations).  And I think both of my solutions have merit, but I do actually think #2 might be more important than #1.  Fortunately, these ideas aren't explicitly tied together.  Well I mean they are here, but that's just because I've got a library that handles both solutions at once.  It could easily be split into one that handles one, or the other.

For Problem/Solution #1, I'll admit I didn't know about `setMutationDefaults` until I was already deep into making my framework.  And maybe if I had known about it, I wouldn't have gone down this path.  It's a pretty good option, and this seems like the use case it was designed for.  This is a failure of my reading the docs.  I didn't see it on the "optimistic updates" page, and while there some references to it elsewhere, the closes thing I could find was [this block of code](https://tanstack.com/query/latest/docs/framework/react/guides/mutations#persist-mutations) related to mutation persisting which is not the same thing.  The only reason I even found that was because after I found the `setMutationDefaults` function in the detailed QueryClient function list, I searched back through the main docs to see if there was something I had missed.  Maybe there should be a reference to this on the optimistic updates page directly?

For Problem/Solution #2, I think my approach is inherently novel.  I don't particularly like the details of how I've hooked into the query resolution process (I'm basically intercepting the data *just* before it goes into the cache in [Query.setData](https://github.com/TanStack/query/blob/2496ba51bb8e10c45f15a9ab9258d53c709dc051/packages/query-core/src/query.ts#L215)) -- but I think the core of the idea is solid.  There are probably better ways to do this -- potentially by having some wrapper around putting a `.then(v => applyImmutableMappers(v))` postProcess to `queryFn`s, or something like that.  But I think that there should be some common library for handling optimistic updates in this manner

# How does my solution actually work (under the hood)??
as mentioned before, I have a subclass of `QueryClient`:
```
queryClient = new InjectableQueryClient();
```

It provides two extra primitives.  You can use one to watch for any mutation updates globally:
```
const watcher = queryClient.watchMutationEvents(
  { mutationKey: ["addTodo"] },
  (mutation) => ({
    // gets called whenever a mutation is seen for the first time.
    // You can use this closure to contain any state you need to manage per-mutation
    onChange(mutationState) {
      // mutationState is the same data shape as you get from `useMutation`
    },
  })
);
watcher.unsucscribe(); // to stop watching
```
It turns out I didn't actually **NEED** to make a subclass or sneakily modify any prototype chains in order to implement this functionality.  I didn't realize that until later.  But you absolutely do need to modify the prototype chain to implement the following (again, since transformData is called just before values are inserted into the query cache)):
```
const injection = queryClient.injectQueryData(
  { queryKey: ["todos"] },
  (query) => ({
    // gets called whenever a query is seen for the first time.
    // You can use this closure to contain any state you need to manage per-query
    transformData(todos) {
      return /* some modification of todos*/;
      /* or, if/when you want to stop, return the `stopInjection` token */
    },
  })
);
injection.unsubscribe();
```

These are remarkably similar primitives, and these are the only bits of extra functionality on `InjectableQueryClient`.  They both have a way of [filtering](https://tanstack.com/query/latest/docs/framework/react/guides/filters), they both have a way of creating a new scope whenever an item (query or mutation) matches, and they both have lifecycle events for unsubscribe.  Because of this, you can write a function that watches for mutations, and the *for every mutation that happens*, creates a separate watch for queries, and ties together the lifecycles of all those properly.  Which is kind of a pain, but it's all done for you by the following

(I put it on a separate object since I didn't want to pollute the interface of `InjectableQueryClient`.  I also made a factory pattern around it (not shown here) -- not sure if that was a good idea or not but whatever, it's not the point):
```
_attachOptimisticFunctionality(queryClient).optimisticData({
  from: { mutationKey: ["addTodo"] },
  to: (mutation) => ({ queryKey: ["todos"] }),
  inject: (mutation) => (todos, mutationState) => {
    // This function is scoped to a specific matching query, and a specific matching mutation
    // Determine whether to stop the injection by returning stopInjection as before,
    // or return an immutable alteration of valueFromServer
  },
  emptyDefaultIfMutationBeforeQuery: [], // don't worry about this for now.  This is a wart of the current design and I want to get rid of it.
});
```

There's also some potential here for helper methods for very common operations.  For example, in my example app I have helper methods for dealing with mutations that add or remove items from an array returned by a query.  This is also using TRPC, so the structure of the arguments is slightly different (for type inference reasons)
```
const client = createOptimisticTRPCClient<AppRouter>((builder, trpc) => {
  let autoDec = 1;
  builder.optimisticArrayRemove(
    {
      from: trpc.threads.delete,
      to: trpc.threads.all,
      // These TRPC endpoints provide both the query and mutation keys,
      // as well as type inference for the below callbacks / parameters
    },
    {
      matchValue(input, fromServer) {
        // all you really need for removing from an array is a match predicate.
        // it infers when to stopInjection by whether the element was present in the list
        return input.id == fromServer.id;
      },
    }
  );
  
  builder.optimisticArrayInsert(
    {
      from: trpc.posts.create,
      to: trpc.posts.allInThread,
      // These TRPC endpoints provide both the query and mutation keys,
      // as well as type inference for the below callbacks / parameters
    },
    {
      fakeValue: (input) => ({ ...input, id: autoDec-- }),
        // generate a fake value to insert.  The id used to match the shape is
        // fake because we don't have a real one yet.  It's negative and unique
        // so it won't collide with real ids.  (generated once per mutation invocation)
      matchValue(input, fromServer, mutationResult) {
        return (mutationResult.data?.id === fromServer.id);
          // on exact ID matches, we know the element has been successfully mutated AND
          // successfully returned by the query.  We can safely stopInjection
      },
    }
})

```


# Playing around

```bash
npm i
npm run dev
```

Try editing the ts files to see the type checking in action :)

### Building

```bash
npm run build
npm run start
```
