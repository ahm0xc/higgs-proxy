import type { ReactNode } from "react";

export function LockedFeature({
  feature,
  children,
}: {
  feature: "image" | "video" | "audio";
  children?: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-xs font-medium tracking-wider text-zinc-500 uppercase dark:text-zinc-400">
          {feature} generation
        </p>
        <h1 className="mt-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          You don't have access to this yet
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
          Ask an admin to enable {feature} generation for your account. The link
          stays hidden until they do.
        </p>
        {children}
      </div>
    </main>
  );
}
