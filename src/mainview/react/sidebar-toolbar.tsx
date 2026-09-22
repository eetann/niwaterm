import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NO_DRAG_REGION_CLASS } from "../drag-region";

export interface SidebarToolbarProps {
  onOpenCommandPalette: () => void;
}

export function SidebarToolbar({ onOpenCommandPalette }: SidebarToolbarProps) {
  return (
    <div className="flex flex-none items-center justify-end border-b px-1 py-1">
      {/* タイトルバー非表示時はツールバー全体がウィンドウのドラッグ領域になるため、
          ボタンだけはクリックを通す（ドラッグ領域でない通常時は何の影響も無い） */}
      <Button
        className={NO_DRAG_REGION_CLASS}
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
