import { ArrowUpToLine, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface PopupToolbarProps {
  onPromote: () => void;
  onMinimize: () => void;
  onClose: () => void;
}

/**
 * popupEl自体にmousedownリスナー（クリック時にIMEフォーカスをpopup側へ向ける）が
 * 設定されているため、ツールバー操作がバブリングして一瞬popup側にフォーカスが奪われるのを防ぐ。
 * ツールバー自体が枠の移動ハンドルを兼ねている件はindex.ts側で弾いており、こちらでは扱わない
 * （Reactのリスナーは#popup-toolbar自身に張られるため、stopPropagationでは同じ要素上の
 * 移動ドラッグのリスナーを止められない）
 */
function stopEventPropagation(e: { stopPropagation: () => void }): void {
  e.stopPropagation();
}

export function PopupToolbar({ onPromote, onMinimize, onClose }: PopupToolbarProps) {
  return (
    // 上辺のリサイズハンドル（.popup-resize-handle、z-index:4）より上へ出し、
    // ボタンの上では枠のリサイズではなくボタンのクリックが優先されるようにする
    <div
      className="relative z-10 flex items-center gap-0.5"
      onPointerDown={stopEventPropagation}
      onMouseDown={stopEventPropagation}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" onClick={onPromote} aria-label="タブへ昇格">
            <ArrowUpToLine />
          </Button>
        </TooltipTrigger>
        <TooltipContent>タブへ昇格</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" onClick={onMinimize} aria-label="最小化">
            <Minus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>最小化</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="閉じる">
            <X />
          </Button>
        </TooltipTrigger>
        <TooltipContent>閉じる</TooltipContent>
      </Tooltip>
    </div>
  );
}
