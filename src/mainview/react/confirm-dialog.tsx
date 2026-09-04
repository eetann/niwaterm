// 破壊的操作（タブ再起動・Board削除等）向けの確認ダイアログ。
// キーバインド起点でもサイドバーの右クリック起点でも使うため、y/n（Escでキャンセル）の
// キー操作とボタンのクリック、どちらでも完結できるようにしてある。
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";

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
          // 漏れる。ここで止めて二重処理を防ぐ。
          // ボタンにフォーカスがあってもkeydownはここまでbubbleしてくるので、
          // y/nはボタン追加後もそのまま効く
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
        {/*
          対応キーはボタン内のKbdで示す（別行のヒント文は持たない）。Escでのキャンセルは
          ダイアログ共通の作法なので明示しない。
          キャンセルをDOM上で先に置く理由: Radixのフォーカストラップは最初のtabbableへ
          自動フォーカスするため、Enter/Spaceの誤爆が「実行」ではなくキャンセル側に落ちる
        */}
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            <Kbd>n</Kbd>
            キャンセル
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            <Kbd className="bg-white/20 text-white">y</Kbd>
            実行
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
