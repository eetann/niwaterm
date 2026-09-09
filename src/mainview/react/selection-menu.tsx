// 選択範囲を右クリックした時のメニュー。ターミナル出力(.term)はReact管理外のDOMのため、
// ContextMenuTriggerで包む代わりに、右クリック座標へ置いた0x0の要素をアンカーにして開く。
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** mouse.selectionMenuが返した項目。runの実体はbun側にあるためidで指す */
export interface SelectionMenuUserItem {
  id: string;
  label: string;
}

export interface SelectionMenuProps {
  open: boolean;
  /** アンカーを置くビューポート座標（右クリックした位置） */
  x: number;
  y: number;
  items: SelectionMenuUserItem[];
  onCopy: () => void;
  onSelectItem: (id: string) => void;
  onClose: () => void;
}

export function SelectionMenu({
  open,
  x,
  y,
  items,
  onCopy,
  onSelectItem,
  onClose,
}: SelectionMenuProps) {
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      // modalにするとbodyがpointer-events:noneになり、閉じた直後のクリックを取りこぼす。
      // メニュー外クリックでの閉じ方はmodalでなくても効く
      modal={false}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          style={{ position: "fixed", left: `${x}px`, top: `${y}px`, width: 0, height: 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={0}
        // 閉じる時のフォーカス復帰先は0x0のアンカーになってしまうため止め、
        // 呼び出し側（onClose）でIME用のtextareaへ戻す
        onCloseAutoFocus={(e) => e.preventDefault()}
        // ConfirmDialogと同じ理由でここで止める（documentまでbubbleすると
        // mainview/index.tsのグローバルkeydownリスナーへ届き、PTYへ入力が漏れる）
        onKeyDown={(e) => e.stopPropagation()}
      >
        <DropdownMenuItem onSelect={onCopy}>コピー</DropdownMenuItem>
        {items.length > 0 && <DropdownMenuSeparator />}
        {items.map((item) => (
          <DropdownMenuItem key={item.id} onSelect={() => onSelectItem(item.id)}>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
