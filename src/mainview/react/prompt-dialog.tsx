// 名前の入力を伴う操作（Board名の変更等）向けの入力ダイアログ。
// サイドバーのインライン編集はサイドバーを開いていないと使えないため、キーバインド・
// コマンドパレット起点の名前変更はこのダイアログで受ける。
// Enterで確定、Escape（およびダイアログ外クリック）でキャンセル。
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";

export interface PromptDialogProps {
  open: boolean;
  title: string;
  description?: string;
  /** 開いた時点で入力欄に入れておく値（現在の名前）。全選択状態で開くので上書き入力しやすい */
  initialValue: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  open,
  title,
  description,
  initialValue,
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [synced, setSynced] = useState({ open, initialValue });

  // このReact rootは開閉のたび同じコンポーネントをrenderし直すだけでunmountされないため、
  // 開いたタイミングで明示的に入れ直さないと前回の入力値が残る。effectで入れ直すと
  // 古い値で一度描画されるので、propsの変化をrender中に検知して入れ直す
  if (synced.open !== open || synced.initialValue !== initialValue) {
    setSynced({ open, initialValue });
    if (open) setValue(initialValue);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        // ConfirmDialogと同じ理由でここで止める（documentまでbubbleすると
        // mainview/index.tsのグローバルkeydownリスナーへ二重に届き、PTYへ入力が漏れる）
        onKeyDown={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit(value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
        />
        {/* キャンセルを先に置く理由はConfirmDialogと同じ（Radixのフォーカストラップ対策）だが、
            こちらはautoFocusした入力欄がフォーカスを取るためEnterは常に確定側へ落ちる */}
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            キャンセル
          </Button>
          <Button size="sm" onClick={() => onSubmit(value)}>
            <Kbd className="bg-primary-foreground/20 text-primary-foreground">Enter</Kbd>
            変更
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
