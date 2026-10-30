import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/image")({ component: ImagePage });

function ImagePage() {
  return <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6" />;
}
