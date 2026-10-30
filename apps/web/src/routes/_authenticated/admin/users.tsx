import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Alert,
  BlockingModal,
  PrimaryButton,
  SecondaryButton,
  TextInput,
} from "~/components/form";
import type { AdminUser } from "~/lib/admin-api";
import {
  createUser,
  deleteUser,
  listUsers,
  resetPassword,
  setBanned,
  updateCapabilities,
} from "~/lib/admin-api";
import type { Capabilities } from "~/lib/session";

export const Route = createFileRoute("/_authenticated/admin/users")({
  beforeLoad: ({ context }) => {
    if (context.auth.user.role !== "admin") throw redirect({ to: "/" });
  },
  component: AdminUsersPage,
});

const CAPABILITY_LABELS: { key: keyof Capabilities; label: string }[] = [
  { key: "image", label: "Image" },
  { key: "video", label: "Video" },
  { key: "audio", label: "Audio" },
];

const EMPTY_CAPABILITIES: Capabilities = {
  image: false,
  video: false,
  audio: false,
};

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newCapabilities, setNewCapabilities] =
    useState<Capabilities>(EMPTY_CAPABILITIES);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [revealed, setRevealed] = useState<{
    email: string;
    password: string;
    reason: "created" | "reset";
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (term: string) => {
    setLoading(true);
    setError(null);

    try {
      const result = await listUsers(term);
      setUsers(result.users);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load users",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  // Debounced search.
  useEffect(() => {
    const handle = window.setTimeout(() => void load(search), 250);
    return () => window.clearTimeout(handle);
  }, [search, load]);

  const adminUser = useMemo(
    () => users.find((u) => u.role === "admin"),
    [users],
  );

  async function onCreate(event: React.FormEvent) {
    event.preventDefault();
    setCreateError(null);
    setCreating(true);

    try {
      const result = await createUser({
        name: newName.trim(),
        email: newEmail.trim().toLowerCase(),
        capabilities: newCapabilities,
      });

      setUsers((current) => [result.user, ...current]);
      setCreateOpen(false);
      setNewName("");
      setNewEmail("");
      setNewCapabilities(EMPTY_CAPABILITIES);
      setCopied(false);
      setRevealed({
        email: result.user.email,
        password: result.password,
        reason: "created",
      });
    } catch (createFailure) {
      setCreateError(
        createFailure instanceof Error
          ? createFailure.message
          : "Failed to create user",
      );
    } finally {
      setCreating(false);
    }
  }

  async function onResetPassword(user: AdminUser) {
    setBusyId(user.id);
    setError(null);

    try {
      const result = await resetPassword(user.id);
      setCopied(false);
      setRevealed({
        email: user.email,
        password: result.password,
        reason: "reset",
      });
    } catch (resetError) {
      setError(
        resetError instanceof Error ? resetError.message : "Reset failed",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function onToggleCapability(user: AdminUser, key: keyof Capabilities) {
    const next: Capabilities = {
      ...user.capabilities,
      [key]: !user.capabilities[key],
    };

    setBusyId(user.id);
    setError(null);

    try {
      await updateCapabilities(user.id, next);
      setUsers((current) =>
        current.map((item) =>
          item.id === user.id ? { ...item, capabilities: next } : item,
        ),
      );
    } catch (updateError) {
      setError(
        updateError instanceof Error ? updateError.message : "Update failed",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function onToggleBanned(user: AdminUser) {
    setBusyId(user.id);
    setError(null);

    try {
      await setBanned(user.id, !user.banned);
      setUsers((current) =>
        current.map((item) =>
          item.id === user.id ? { ...item, banned: !item.banned } : item,
        ),
      );
    } catch (banError) {
      setError(banError instanceof Error ? banError.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(user: AdminUser) {
    if (
      !window.confirm(
        `Delete ${user.email}? Their sessions are revoked and their capability record is removed.`,
      )
    ) {
      return;
    }

    setBusyId(user.id);
    setError(null);

    try {
      await deleteUser(user.id);
      setUsers((current) => current.filter((item) => item.id !== user.id));
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Delete failed",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function copyPassword() {
    if (!revealed) return;

    try {
      await navigator.clipboard.writeText(revealed.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Users
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Create accounts, choose what each person can generate, and reset
            passwords.
          </p>
        </div>
        <PrimaryButton
          type="button"
          onClick={() => {
            setCreateError(null);
            setCreateOpen((open) => !open);
          }}
        >
          {createOpen ? "Close" : "Add user"}
        </PrimaryButton>
      </div>

      {error ? (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      {createOpen ? (
        <form
          onSubmit={onCreate}
          className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            New user
          </h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            The password is generated for you and shown once after the account
            is created.
          </p>

          {createError ? (
            <div className="mt-3">
              <Alert>{createError}</Alert>
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Name"
              required
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Grace Hopper"
            />
            <TextInput
              label="Email"
              type="email"
              required
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              placeholder="grace@example.com"
            />
          </div>

          <fieldset className="mt-4">
            <legend className="text-xs font-medium tracking-wide text-zinc-600 uppercase dark:text-zinc-400">
              Can generate
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {CAPABILITY_LABELS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={newCapabilities[key]}
                  onClick={() =>
                    setNewCapabilities((current) => ({
                      ...current,
                      [key]: !current[key],
                    }))
                  }
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    newCapabilities[key]
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              No capability is selected. The account can still sign in; it just
              has nothing to do.
            </p>
          </fieldset>

          <div className="mt-5 flex justify-end">
            <PrimaryButton type="submit" loading={creating}>
              Create user
            </PrimaryButton>
          </div>
        </form>
      ) : null}

      <div className="mt-6 max-w-xs">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name or email"
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-400 dark:focus:ring-zinc-100/10"
        />
      </div>

      <div className="mt-3 overflow-x-auto rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full min-w-3xl border-collapse text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs tracking-wide text-zinc-500 uppercase dark:border-zinc-800 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Can generate</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Last login</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && !loading ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400"
                >
                  No users match that search.
                </td>
              </tr>
            ) : null}

            {users.map((user) => {
              const isAdmin = user.role === "admin";
              const busy = busyId === user.id;

              return (
                <tr
                  key={user.id}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-zinc-900 dark:text-zinc-50">
                      {user.name}
                      {isAdmin ? (
                        <span className="ml-2 rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase dark:bg-zinc-100 dark:text-zinc-900">
                          Admin
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {user.email}
                    </p>
                  </td>

                  <td className="px-4 py-3">
                    {isAdmin ? (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        Full access
                      </span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {CAPABILITY_LABELS.map(({ key, label }) => (
                          <button
                            key={key}
                            type="button"
                            disabled={busy}
                            aria-pressed={user.capabilities[key]}
                            onClick={() => void onToggleCapability(user, key)}
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                              user.capabilities[key]
                                ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
                                : "border-zinc-200 bg-zinc-50 text-zinc-400 line-through dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-600"
                            }`}
                            title={`Toggle ${label.toLowerCase()} access`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                        user.banned
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-emerald-700 dark:text-emerald-400"
                      }`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${
                          user.banned ? "bg-rose-500" : "bg-emerald-500"
                        }`}
                      />
                      {user.banned ? "Disabled" : "Active"}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                    {formatDate(user.lastLoginAt)}
                  </td>

                  <td className="px-4 py-3">
                    {isAdmin ? (
                      <p className="text-right text-xs text-zinc-400 dark:text-zinc-500">
                        —
                      </p>
                    ) : (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <SecondaryButton
                          type="button"
                          disabled={busy}
                          onClick={() => void onResetPassword(user)}
                        >
                          Reset password
                        </SecondaryButton>
                        <SecondaryButton
                          type="button"
                          disabled={busy}
                          onClick={() => void onToggleBanned(user)}
                        >
                          {user.banned ? "Enable" : "Disable"}
                        </SecondaryButton>
                        <SecondaryButton
                          type="button"
                          disabled={busy}
                          onClick={() => void onDelete(user)}
                          className="text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                        >
                          Delete
                        </SecondaryButton>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {adminUser ? (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          The admin account is not listed under actions: admins always have full
          access and their password is never reset from here.
        </p>
      ) : null}

      <BlockingModal
        open={revealed !== null}
        title={
          revealed?.reason === "reset" ? "New password" : "Account created"
        }
        description={
          revealed
            ? `Password for ${revealed.email}. This is the only time it will ever be shown — we store only a hash.`
            : undefined
        }
        footer={
          <PrimaryButton
            type="button"
            onClick={() => {
              setRevealed(null);
              setCopied(false);
            }}
          >
            I've saved it
          </PrimaryButton>
        }
      >
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-sm tracking-wider text-zinc-900 select-all dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100">
            {revealed?.password}
          </code>
          <SecondaryButton type="button" onClick={() => void copyPassword()}>
            {copied ? "Copied" : "Copy"}
          </SecondaryButton>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Lost it? Close this and use “Reset password” to generate a new one.
          Resetting also signs that user out everywhere.
        </p>
      </BlockingModal>
    </main>
  );
}
