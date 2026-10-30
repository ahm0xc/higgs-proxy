import { Link, useRouter } from "@tanstack/react-router";
import type { Capabilities } from "~/lib/session";

import { SignedIn, useAuth } from "~/components/auth";
import { CliStatus } from "~/components/cli-status";
import { UserMenu } from "~/components/user-menu";
import { useCliStatus } from "~/hooks/use-cli-status";
import { authClient } from "~/lib/auth-client";
import { invalidateSession } from "~/lib/session";

const navItems = [
  { label: "Image", to: "/image", capability: "image" },
  { label: "Video", to: "/video", capability: "video" },
  { label: "Audio", to: "/audio", capability: "audio" },
] as const;

function can(navItem: (typeof navItems)[number], capabilities: Capabilities) {
  return capabilities[navItem.capability];
}

export function Header() {
  const router = useRouter();
  const auth = useAuth();
  const cli = useCliStatus({ enabled: auth !== null });

  async function signOut() {
    await authClient.signOut();
    invalidateSession();
    await router.invalidate();
    await router.navigate({ to: "/login" });
  }

  const visibleNav = auth
    ? navItems.filter((item) => can(item, auth.capabilities))
    : [];

  // Workspace-wide balance, shown as the badge on the avatar.
  const credits =
    cli.status.state === "ready" ? cli.status.data.account?.credits : undefined;

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200/80 bg-white/80 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto grid h-16 max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <img
            src="/icon.png"
            alt="higgs proxy logo"
            className="size-8 rounded-lg"
          />
          <span className="hidden text-base font-semibold tracking-tight text-zinc-900 sm:inline dark:text-zinc-50">
            higgs proxy
          </span>
        </Link>

        <nav
          aria-label="Media types"
          className="flex items-center gap-0.5 sm:gap-1"
        >
          {visibleNav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-full px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 sm:px-4 sm:text-sm dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              activeProps={{
                className:
                  "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 justify-self-end sm:gap-3">
          <SignedIn>
            {(session) => (
              <>
                <CliStatus status={cli.status} refresh={cli.refresh} />
                <UserMenu
                  user={session.user}
                  credits={credits}
                  onSignOut={() => void signOut()}
                />
              </>
            )}
          </SignedIn>
        </div>
      </div>
    </header>
  );
}
