import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="panel max-w-md p-8 text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="panel max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, interactive-widget=resizes-content" },
      { title: "BookedSecure" },
      {
        name: "description",
        content:
          "Fast SMS responses, guided qualification and completed-job tracking for mobile detailing enquiries.",
      },
      { name: "author", content: "BookedSecure" },
      { property: "og:title", content: "BookedSecure" },
      {
        property: "og:description",
        content:
          "Respond to detailing enquiries in minutes and track completed-job revenue by source.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],

    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Outfit:wght@500;600;700&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // Temporary scroll diagnostic: when a wheel event fails to move anything,
  // log what swallowed it so the stuck-scroll report can be pinned down.
  useEffect(() => {
    let timer: number | undefined;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      const target = event.target as HTMLElement | null;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const scrolledWindow = Math.abs(window.scrollY) > 0;
        const scrolledAncestor = (() => {
          let node = target?.parentElement ?? null;
          while (node) {
            if (node.scrollTop !== 0) return true;
            node = node.parentElement;
          }
          return false;
        })();
        const docScrollable =
          document.documentElement.scrollHeight > window.innerHeight + 4;
        if (!scrolledWindow && !scrolledAncestor && docScrollable) {
          const describe = (el: Element | null) =>
            el
              ? `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").slice(0, 120)}`
              : "none";
          console.warn("[scroll-diagnostic] wheel did not scroll", {
            url: window.location.pathname,
            bodyOverflow: getComputedStyle(document.body).overflow,
            bodyInlineOverflow: document.body.style.overflow,
            htmlOverflow: getComputedStyle(document.documentElement).overflow,
            scrollHeight: document.documentElement.scrollHeight,
            innerHeight: window.innerHeight,
            target: describe(target),
            underCursor: describe(
              document.elementFromPoint(event.clientX, event.clientY),
            ),
          });
        }
      }, 350);
    };
    window.addEventListener("wheel", onWheel, { passive: true, capture: true });
    return () => {
      window.removeEventListener("wheel", onWheel, { capture: true });
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster position="top-right" />
    </QueryClientProvider>
  );
}
