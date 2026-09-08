import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Sensible app-wide caching so page-to-page navigation reuses data
        // already fetched instead of re-requesting it.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Preload the next page's code on hover/tap intent so navigation feels
    // instant instead of waiting for a chunk download.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 30_000,
  });


  return router;
};
