import { Link } from "@tanstack/react-router";

export const navItems = [
  { label: "Image", to: "/image" },
  { label: "Video", to: "/video" },
  { label: "Audio", to: "/audio" },
] as const;

export function CliStatus() {
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-100 px-2.5 py-1 font-mono text-[11px] font-medium tracking-wider text-zinc-600 uppercase sm:px-3"
      title="CLI status (demo data)"
      aria-label="CLI status: connected"
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
      </span>
      <span className="hidden sm:inline">CLI</span>
      <span aria-hidden className="hidden text-zinc-400 sm:inline">
        •
      </span>
      <span className="hidden text-zinc-800 sm:inline">connected</span>
    </div>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200/80 bg-white/80 backdrop-blur-md">
      <div className="mx-auto grid h-16 max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <img
            src="/icon.png"
            alt="higgs proxy logo"
            className="size-8 rounded-lg"
          />
          <span className="hidden text-base font-semibold tracking-tight text-zinc-900 sm:inline">
            higgs proxy
          </span>
        </Link>

        <nav
          aria-label="Media types"
          className="flex items-center gap-0.5 sm:gap-1"
        >
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="rounded-full px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 sm:px-4 sm:text-sm"
              activeProps={{
                className: "bg-zinc-100 text-zinc-900",
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="justify-self-end">
          <CliStatus />
        </div>
      </div>
    </header>
  );
}
