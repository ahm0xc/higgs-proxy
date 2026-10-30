import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@heroui/react";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <div className="p-8">
      <Button onPress={() => alert("HeroUI is working!")}>My Button</Button>
    </div>
  );
}
