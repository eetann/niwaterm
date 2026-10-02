// 現在有効な設定値を一覧するモーダル（show-configアクション）。中身はbun側が組み立てた
// ConfigSummaryをそのまま並べるだけで、表示以外の判断はここでは持たない
// （CLIの`niwa config show`と同じ内容を出すため）。
import { CircleAlert } from "lucide-react";
import type { ConfigSummary } from "../../bun/config-summary";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

export interface ConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: ConfigSummary | null;
}

/** 色の値（前景・背景・ANSIパレット）は文字列だけだと照合できないため、実際の色を並べて添える */
function Swatches({ colors }: { colors: string[] }) {
  return (
    <span className="mr-1 inline-flex shrink-0 gap-px align-middle">
      {colors.map((color, i) => (
        <span
          // ANSIパレットは同じ色が複数indexに入りうるため、色ではなくindexをkeyにする
          key={i}
          className="inline-block size-3 rounded-xs border border-border"
          style={{ background: color }}
        />
      ))}
    </span>
  );
}

export function ConfigDialog({ open, onOpenChange, summary }: ConfigDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[80vh] gap-3 overflow-y-auto sm:max-w-2xl"
        onKeyDown={(e) => {
          // ダイアログ内のキー入力がdocumentまでbubbleするとPTYへ漏れる（confirm-dialogと同じ理由）。
          // Escapeの検知もdocumentリスナー（Radix）任せにはできなくなるため、ここで閉じる
          e.stopPropagation();
          if (e.key === "Escape") onOpenChange(false);
        }}
      >
        <DialogHeader>
          <DialogTitle>現在の設定</DialogTitle>
        </DialogHeader>
        {summary === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner />
            設定を読み込み中です
          </p>
        ) : (
          <>
            <p className="text-xs break-words text-muted-foreground">
              {summary.configFile}
              {!summary.configFileLoaded && " (未読み込み。全項目が既定値です)"}
            </p>
            {/* 「設定したのに効かない」時に真っ先に見る情報なので、設定値一覧より前に出す */}
            {summary.loadError !== null && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>読み込みエラー</AlertTitle>
                <AlertDescription>
                  <p className="break-words font-mono text-xs">{summary.loadError}</p>
                  <p className="text-muted-foreground text-xs">
                    {summary.configFileLoaded
                      ? "直前に読み込めた設定のまま動いています（以下はその内容）"
                      : "全項目が既定値です"}
                  </p>
                </AlertDescription>
              </Alert>
            )}
            {summary.diagnostics.length > 0 && (
              <section>
                <h3 className="mb-1 font-semibold text-sm">無視した設定</h3>
                <ul className="space-y-1 text-xs">
                  {summary.diagnostics.map((diagnostic) => (
                    <li key={`${diagnostic.scope}:${diagnostic.message}`} className="break-words">
                      <span className="font-mono text-muted-foreground">{diagnostic.scope}</span>
                      <span className="ml-2">{diagnostic.message}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {summary.sections.map((section) => (
              <section key={section.name}>
                <h3 className="mb-1 font-semibold text-sm">{section.name}</h3>
                <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-1 text-xs">
                  {section.entries.map((entry) => (
                    <div key={entry.key} className="contents">
                      <dt className="text-muted-foreground">{entry.key}</dt>
                      <dd className="break-words">
                        {entry.swatches && <Swatches colors={entry.swatches} />}
                        <span className="font-mono">{entry.value}</span>
                        {entry.note && (
                          <span className="ml-2 text-muted-foreground">{entry.note}</span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
