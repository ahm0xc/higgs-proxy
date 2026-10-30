import { Outlet, createRootRoute, redirect } from "@tanstack/react-router";

import { AuthProvider } from "~/components/auth";
import { Header } from "~/components/header";
import { fetchNeedsSetup, fetchSession } from "~/lib/session";

import "../styles.css";

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    const needsSetup = await fetchNeedsSetup();

    // An unclaimed instance has exactly one valid destination.
    if (needsSetup) {
      if (location.pathname !== "/setup") {
        throw redirect({ to: "/setup" });
      }

      return { needsSetup, auth: null };
    }

    const auth = await fetchSession();

    if (!auth && location.pathname === "/setup") {
      throw redirect({ to: "/login" });
    }

    return { needsSetup, auth };
  },
  component: RootComponent,
});

function RootComponent() {
  const { auth } = Route.useRouteContext();

  return (
    <AuthProvider session={auth}>
      <div className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <Header />
        <Outlet />
      </div>
    </AuthProvider>
  );
}
