// Board 0個のワークスペースで#tile-treeの代わりに出す空状態。この画面にはCLIを打つタブも無いため、
// ボタンがBoard 0個の状態から抜ける唯一のGUI操作になる
import { LayoutDashboard, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";

export interface NoBoardProps {
  /** キーバインドで作る場合の表示ラベル（例: "Ctrl+B C"）。prefix未設定・未割り当てならundefined */
  newBoardShortcut?: string;
  onNewBoard: () => void;
}

export function NoBoard({ newBoardShortcut, onNewBoard }: NoBoardProps) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LayoutDashboard />
        </EmptyMedia>
        <EmptyTitle>Boardがありません</EmptyTitle>
        <EmptyDescription>
          このワークスペースのBoardはすべて閉じられています。新しいBoardを作ると作業を再開できます
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onNewBoard}>
          <Plus />
          新しいBoardを作成
          {newBoardShortcut && (
            <Kbd className="bg-primary-foreground/20 text-primary-foreground">
              {newBoardShortcut}
            </Kbd>
          )}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
