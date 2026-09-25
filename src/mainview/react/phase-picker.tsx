// アクティブBoardへ付ける作業フェーズを選ぶピッカー。移動先ワークスペースのピッカーと同じく
// CommandDialogの上に建てて、絞り込み・上下キー・Enter・Escの作法をコマンドパレットと揃える
// （サイドバーを開かずキーボードだけでフェーズを切り替えられるようにするためのUI）。
import { Check, Tag, X } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { ResolvedBoardPhase } from "@niwaterm/config";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

export interface PhasePickerProps {
  open: boolean;
  /** 何のフェーズを選んでいるかの見出し。CommandDialogのタイトルはsr-onlyなので、目に見えるのはこちら */
  heading: string;
  /** 設定（board.phases）の候補。空なら候補を定義する案内だけが出る */
  phases: readonly ResolvedBoardPhase[];
  /** 今付いているフェーズ。未設定はnull（解除の項目もこのときだけ出す） */
  current: ResolvedBoardPhase | null;
  onOpenChange: (open: boolean) => void;
  /** 選んだフェーズのid。解除を選んだ場合はnull */
  onSelect: (phaseId: string | null) => void;
}

/**
 * Tab / Shift+Tabでも候補を上下できるようにする。cmdkは選択位置を動かすAPIを公開しておらず、
 * ↑↓のkeydownをCommandのルート側で拾っているため、同じキーのイベントを投げ直して合わせる。
 * stopPropagationはDialogのフォーカストラップに渡さないためで、渡すと入力欄の文字列が
 * 全選択されて次の打鍵で消える
 */
function moveSelectionOnTab(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key !== "Tab") return;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: event.shiftKey ? "ArrowUp" : "ArrowDown",
      bubbles: true,
    }),
  );
}

export function PhasePicker({
  open,
  heading,
  phases,
  current,
  onOpenChange,
  onSelect,
}: PhasePickerProps) {
  // 候補に無い値（CLIで直接付けたもの）が今のフェーズなら、その値も末尾に足す。
  // チェックの付いた項目がどこにも無いと今の状態を読み取れなくなるため
  const custom =
    current !== null && !phases.some((phase) => phase.id === current.id) ? current : null;
  const items = custom ? [...phases, custom] : phases;

  // 閉じたことを伝えると呼び出し側がonSelectを捨てるため、選択の通知を先に済ませる
  function choose(phaseId: string | null): void {
    onSelect(phaseId);
    onOpenChange(false);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={heading}
      description="Boardに付ける作業フェーズを検索"
    >
      <CommandInput placeholder="フェーズを検索..." onKeyDown={moveSelectionOnTab} />
      <CommandList>
        <CommandEmpty>該当するフェーズがありません</CommandEmpty>
        <CommandGroup heading={heading}>
          {items.length === 0 && (
            <CommandItem disabled value="no-phases">
              <Tag />
              <span className="min-w-0 flex-1 truncate">
                設定のboard.phasesで候補を定義できます
              </span>
            </CommandItem>
          )}
          {items.map((phase) => (
            <CommandItem
              key={phase.id}
              // ラベルが同じ候補があってもcmdkの値が衝突しないようidを混ぜる
              value={`${phase.label} ${phase.id}`}
              onSelect={() => choose(phase.id)}
            >
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: phase.color ?? "var(--ui-accent)" }}
              />
              <span className="min-w-0 flex-1 truncate">{phase.label}</span>
              {current?.id === phase.id && (
                <Check aria-label="設定中" className="shrink-0 text-muted-foreground" />
              )}
            </CommandItem>
          ))}
        </CommandGroup>
        {current && (
          <>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem value="clear phase 解除" onSelect={() => choose(null)}>
                <X />
                <span className="min-w-0 flex-1 truncate">フェーズを解除</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
