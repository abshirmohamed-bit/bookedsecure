import { createFileRoute, redirect } from "@tanstack/react-router";

/** Performance now lives on Home; this path keeps old links working. */
export const Route = createFileRoute("/analytics")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard", replace: true });
  },
});
