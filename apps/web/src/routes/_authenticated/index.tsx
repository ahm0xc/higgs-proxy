import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/")({
  component: Home,
});

const media = [
  {
    to: "/image",
    label: "Image",
    capability: "image",
    blurb: "Text to image, upscales and variations.",
  },
  {
    to: "/video",
    label: "Video",
    capability: "video",
    blurb: "Image to video and text to video clips.",
  },
  {
    to: "/audio",
    label: "Audio",
    capability: "audio",
    blurb: "Voice, music and sound effects.",
  },
] as const;

function Home() {
  const { auth } = Route.useRouteContext();
  const allowed = media.filter((item) => auth.capabilities[item.capability]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <p className="text-xs font-medium tracking-wider text-zinc-500 uppercase dark:text-zinc-400">
        Signed in as {auth.user.email}
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Welcome, {auth.user.name}
      </h1>

      {allowed.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
            No generation access yet
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
            Your account works, but an admin hasn't given you access to images,
            video or audio. Ask them to enable it.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {allowed.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="group rounded-2xl border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/60"
            >
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {item.label}
              </span>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {item.blurb}
              </p>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
