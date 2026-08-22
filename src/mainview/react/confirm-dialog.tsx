// キーバインドから起動する破壊的操作（タブ再起動等）向けの確認ダイアログ。
// マウスクリックを介さず、y/n（Escでキャンセル）のキー入力だけで完結させる。
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        onKeyDown={(e) => {
          // stopPropagationしないと、このイベントがdocumentまでbubbleして
          // mainview/index.tsのグローバルkeydownリスナーにも届いてしまう。そちらの
          // confirmDialogOpenガードはReactのstate反映と同期しているとは限らず
          // （onCancel内でconfirmDialogOpenをfalseにした直後に同じイベントが
          // documentへ到達しガードをすり抜ける）、押したキーがPTYへの入力として
          // 漏れる（実機検証で発覚）。ここで止めて二重処理を防ぐ
          e.stopPropagation();
          if (e.key === "y" || e.key === "Y") {
            e.preventDefault();
            onConfirm();
          } else if (e.key === "n" || e.key === "N") {
            e.preventDefault();
            onCancel();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <p className="text-xs text-muted-foreground">y: 実行 / n・Esc: キャンセル</p>
      </DialogContent>
    </Dialog>
  );
}
