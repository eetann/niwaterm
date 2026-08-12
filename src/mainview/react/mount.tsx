import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";

function ReactRoot() {
  return (
    <div className="p-2">
      <Button>shadcn/ui Button</Button>
    </div>
  );
}

export function mountReactRoot() {
  const el = document.getElementById("react-root");
  if (!el) return;
  createRoot(el).render(<ReactRoot />);
}
