import { Avatar } from "@heroui/react/avatar";
import { Badge } from "@heroui/react/badge";
import { Dropdown } from "@heroui/react/dropdown";
import { useRouter } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";

import type { SessionUser } from "~/lib/session";
import type { ThemePreference } from "~/lib/theme";
import {
  getThemePreference,
  setThemePreference,
  subscribeToTheme,
} from "~/lib/theme";

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function avatarUrlFor(userId: string) {
  return `https://api.dicebear.com/10.x/glass/svg?seed=${encodeURIComponent(userId)}`;
}

function formatCredits(credits: number) {
  // Whole credits only — fractional balances are truncated, never rounded up.
  return Math.floor(credits).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
}

const THEME_OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

export function UserMenu({
  user,
  credits,
  onSignOut,
}: {
  user: SessionUser;
  credits: number | undefined;
  onSignOut: () => void;
}) {
  const router = useRouter();
  const preference = useSyncExternalStore(
    subscribeToTheme,
    getThemePreference,
    () => "system" as ThemePreference,
  );

  const creditsLabel = credits === undefined ? null : formatCredits(credits);
  const creditsColor =
    credits !== undefined && credits < 1 ? "danger" : "accent";

  return (
    <Dropdown>
      <Dropdown.Trigger
        aria-label={
          creditsLabel === null
            ? `Account menu for ${user.name}`
            : `Account menu for ${user.name}, ${creditsLabel} credits left`
        }
        className="flex cursor-pointer items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-500"
      >
        <Badge.Anchor>
          <Avatar size="sm" className="size-8">
            <Avatar.Image src={avatarUrlFor(user.id)} alt="" />
            <Avatar.Fallback>{initialsOf(user.name)}</Avatar.Fallback>
          </Avatar>
          {creditsLabel === null ? null : (
            <Badge color={creditsColor} size="sm">
              {creditsLabel}
            </Badge>
          )}
        </Badge.Anchor>
      </Dropdown.Trigger>

      <Dropdown.Popover className="w-64">
        <div className="mb-1 flex items-center gap-2.5 border-b border-zinc-200 px-2 pt-2 pb-2.5 dark:border-zinc-800">
          <Avatar size="sm" className="size-8 shrink-0">
            <Avatar.Image src={avatarUrlFor(user.id)} alt="" />
            <Avatar.Fallback>{initialsOf(user.name)}</Avatar.Fallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {user.name}
            </p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {user.email}
            </p>
          </div>
        </div>

        <Dropdown.Menu
          onAction={(key) => {
            if (key === "users") {
              void router.navigate({ to: "/admin/users" });
            } else if (key === "signout") {
              onSignOut();
            }
          }}
        >
          {user.role === "admin" ? (
            <Dropdown.Item id="users" textValue="Manage users">
              Manage users
            </Dropdown.Item>
          ) : null}

          <Dropdown.SubmenuTrigger>
            <Dropdown.Item id="appearance" textValue="Appearance">
              Appearance
              <Dropdown.SubmenuIndicator />
            </Dropdown.Item>
            <Dropdown.Popover>
              <Dropdown.Menu
                selectionMode="single"
                disallowEmptySelection
                selectedKeys={[preference]}
                onSelectionChange={(keys) => {
                  if (keys === "all") return;
                  const next = Array.from(keys)[0];
                  if (next) setThemePreference(String(next) as ThemePreference);
                }}
              >
                {THEME_OPTIONS.map((option) => (
                  <Dropdown.Item
                    key={option.id}
                    id={option.id}
                    textValue={option.label}
                  >
                    {option.label}
                    <Dropdown.ItemIndicator />
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown.SubmenuTrigger>

          <Dropdown.Item
            id="signout"
            textValue="Sign out"
            className="text-rose-600 dark:text-rose-400"
          >
            Sign out
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
