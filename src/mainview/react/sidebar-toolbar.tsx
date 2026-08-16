import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SidebarToolbarProps {
  onOpenCommandPalette: () => void;
}

export function SidebarToolbar({ onOpenCommandPalette }: SidebarToolbarProps) {
  return (
    <div className="flex flex-none items-center justify-end border-b px-1 py-1">
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onOpenCommandPalette}
        title="コマンドパレットを開く"
      >
        <Search />
      </Button>
    </div>
  );
}
