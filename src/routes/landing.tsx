import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The pilot page now lives on the main page (and at /home). This route only
 * exists so previously shared /landing links keep working.
 */
export const Route = createFileRoute("/landing")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
});
