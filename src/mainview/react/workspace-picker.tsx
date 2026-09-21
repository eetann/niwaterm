// Boardの移動先ワークスペースを選ぶピッカー。コマンドパレットと同じCommandDialogの上に建てて
// あるため、絞り込み・上下キー・Enter・Escの作法がパレットとそのまま揃う
// （キーバインド起点でもサイドバーを開かずキーボードだけで完結できる）。
import { Folder } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { WorkspaceId } from "../../bun/workspace-manager";

export interface WorkspacePickerItem {
  workspaceId: WorkspaceId;
  label: string;
  /** 「3 boards」のような補助表示。名前未設定のワークスペースを見分ける手がかりにする */
  boardCount: number;
}

export interface WorkspacePickerProps {
  open: boolean;
  /** 何を移そうとしているかの見出し。CommandDialogのタイトルはsr-onlyなので、目に見えるのはこちら */
  heading: string;
  items: WorkspacePickerItem[];
  onOpenChange: (open: boolean) => void;
  onSelect: (workspaceId: WorkspaceId) => void;
}

export function WorkspacePicker({
  open,
  heading,
  items,
  onOpenChange,
  onSelect,
}: WorkspacePickerProps) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={heading}
      description="移動先のワークスペースを検索"
    >
      <CommandInput placeholder="ワークスペースを検索..." />
      <CommandList>
        <CommandEmpty>移動先にできるワークスペースがありません</CommandEmpty>
        <CommandGroup heading={heading}>
          {items.map((item) => (
            <CommandItem
              key={item.workspaceId}
              // 同名のワークスペースがあってもcmdkの値が衝突しないようidを混ぜる
              value={`${item.label} ${item.workspaceId}`}
              onSelect={() => {
                onOpenChange(false);
                onSelect(item.workspaceId);
              }}
            >
              <Folder />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {item.boardCount} boards
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
