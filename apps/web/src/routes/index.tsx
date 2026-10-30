import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@heroui/react";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <Button onPress={() => alert("HeroUI is working!")}>My Button</Button>
    </main>
  );
}
