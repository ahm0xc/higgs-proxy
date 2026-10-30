import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/video")({ component: VideoPage });

function VideoPage() {
  return <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6" />;
}
