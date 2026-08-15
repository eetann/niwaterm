import { ArrowUpToLine, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface PopupToolbarProps {
  onPromote: () => void;
  onMinimize: () => void;
  onClose: () => void;
}

/**
 * popupEl自体にmousedownリスナー（クリック時にIMEフォーカスをpopup側へ向ける）が
 * 設定されているため、ツールバー操作がバブリングして一瞬popup側にフォーカスが奪われるのを防ぐ
 */
function stopEventPropagation(e: { stopPropagation: () => void }): void {
  e.stopPropagation();
}

export function PopupToolbar({ onPromote, onMinimize, onClose }: PopupToolbarProps) {
  return (
    <div
      className="flex items-center gap-0.5 rounded-md bg-background/80 p-0.5"
      onPointerDown={stopEventPropagation}
      onMouseDown={stopEventPropagation}
    >
      <Button variant="ghost" size="icon-xs" onClick={onPromote} title="タブへ昇格">
        <ArrowUpToLine />
      </Button>
      <Button variant="ghost" size="icon-xs" onClick={onMinimize} title="最小化">
        <Minus />
      </Button>
      <Button variant="ghost" size="icon-xs" onClick={onClose} title="閉じる">
        <X />
      </Button>
    </div>
  );
}
