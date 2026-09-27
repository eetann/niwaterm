import { ArrowUpToLine, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

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
