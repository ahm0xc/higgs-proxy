import { Outlet, createRootRoute } from "@tanstack/react-router";

import { Header } from "~/components/header";

import "../styles.css";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <div className="min-h-dvh bg-zinc-50">
      <Header />
      <Outlet />
    </div>
  );
}
