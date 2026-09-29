import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NO_DRAG_REGION_CLASS } from "../drag-region";

export interface SidebarToolbarProps {
  onOpenCommandPalette: () => void;
}

export function SidebarToolbar({ onOpenCommandPalette }: SidebarToolbarProps) {
  return (
    <div className="flex flex-none items-center justify-end border-b px-1 py-1">
      {/* タイトルバー非表示時はツールバー全体がウィンドウのドラッグ領域になるため、
          ボタンだけはクリックを通す（ドラッグ領域でない通常時は何の影響も無い） */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={NO_DRAG_REGION_CLASS}
            variant="ghost"
            size="icon-xs"
            onClick={onOpenCommandPalette}
            aria-label="コマンドパレットを開く"
          >
            <Search />
          </Button>
        </TooltipTrigger>
        <TooltipContent>コマンドパレットを開く</TooltipContent>
      </Tooltip>
    </div>
  );
}
