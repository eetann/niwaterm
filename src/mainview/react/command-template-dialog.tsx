// コマンドテンプレート（commandTemplates）の入力モーダル。上にでき上がるコマンドのプレビュー、
// 下に`{{name}}`ごとの入力欄を並べ、Ctrl+Enterで貼る・Ctrl+Shift+Enterで貼って実行・Ctrl+Shift+Cでコピーする。
// 素のEnterでは送らない。入力フォームのEnterは選択肢の一覧を開く・ボタンを押すといった欄ごとの
// 操作に使われるもので、送る操作に充てると選び終える前に誤送信しやすいため。
// 選択肢の欄は候補が多くても探せるよう、コマンドパレットと同じ絞り込み付きの一覧にする。
import { Check, ChevronsUpDown, SquareTerminal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  type CommandTemplateAction,
  emptyFieldNames,
  parseCommandTemplate,
  type PreparedCommandTemplate,
  type PreparedCommandTemplateField,
  quoteShellArg,
} from "../../shared/command-template";
import { moveTabFocus } from "../tab-focus";

export interface CommandTemplateDialogProps {
  open: boolean;
  /** 選択肢を取り寄せている間はnull（読み込み中として出す） */
  template: PreparedCommandTemplate | null;
  /** ショートカットの表記に使う修飾キー。macOSは"Cmd"、それ以外は"Ctrl" */
  modKeyLabel: string;
  onSubmit: (values: Record<string, string>, action: CommandTemplateAction) => void;
  onCancel: () => void;
  /**
   * 閉じ切った直後のフォーカス戻し。既定ではRadixが開く前の要素へ戻すため、
   * 呼び出し側でターミナルへフォーカスを移す
   */
  onCloseAutoFocus?: (event: Event) => void;
}

function initialValues(template: PreparedCommandTemplate | null): Record<string, string> {
  return Object.fromEntries((template?.fields ?? []).map((field) => [field.name, field.initial]));
}

export function CommandTemplateDialog({
  open,
  template,
  modKeyLabel,
  onSubmit,
  onCancel,
  onCloseAutoFocus,
}: CommandTemplateDialogProps) {
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(template));
  const [focused, setFocused] = useState<string | null>(null);
  // 空のまま送ろうとするまでは空欄を責めない（開いた直後から赤くすると入力の邪魔になる）
  const [attempted, setAttempted] = useState(false);
  // 開いている選択肢の一覧。開いている間のEnterは候補を選ぶキーなので、送る操作へ回さない
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const fieldRefs = useRef(new Map<string, HTMLElement>());

  // このReact rootは開閉のたび同じコンポーネントをrenderし直すだけでunmountされないため、
  // 別のテンプレートを開いた・開き直したタイミングで明示的に入れ直さないと前回の入力値が残る
  useEffect(() => {
    if (!open) return;
    setValues(initialValues(template));
    setFocused(template?.fields[0]?.name ?? null);
    setAttempted(false);
    setOpenPicker(null);
  }, [open, template]);

  const segments = useMemo(() => parseCommandTemplate(template?.command ?? ""), [template]);
  const fieldByName = useMemo(
    () => new Map((template?.fields ?? []).map((field) => [field.name, field])),
    [template],
  );
  const empty = template
    ? emptyFieldNames(
        template.fields.map((field) => field.name),
        values,
      )
    : [];

  const submit = (action: CommandTemplateAction) => {
    if (!template) return;
    if (empty.length > 0) {
      setAttempted(true);
      const first = empty[0];
      if (first !== undefined) fieldRefs.current.get(first)?.focus();
      return;
    }
    onSubmit(values, action);
  };

  const setValue = (name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        // grid-cols-1で列幅をモーダルの幅に固定する。既定の列幅だと、長い候補・コマンドの幅に
        // 引っ張られてモーダルがウィンドウからはみ出す
        className="top-24 translate-y-0 grid-cols-1 gap-0 p-0 sm:max-w-2xl"
        onCloseAutoFocus={onCloseAutoFocus}
        // documentまでbubbleするとmainview/index.tsのグローバルkeydownリスナーへ二重に届き、
        // PTYへ入力が漏れる（ConfirmDialog・PromptDialogと同じ）
        // Tabの移動は自前で行う（理由はtab-focus.ts）。キャプチャ段階で止めるのは、同じ要素に
        // 付くRadixのフォーカストラップが移動後のフォーカスを端と見なし、反対の端へ飛ばし直すため。
        // 一覧を開いている間のTabは候補の移動に使うので触らない
        onKeyDownCapture={(e) => {
          if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey) return;
          if (e.nativeEvent.isComposing || openPicker !== null) return;
          if (!moveTabFocus(e.currentTarget, e.shiftKey)) return;
          e.preventDefault();
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.nativeEvent.isComposing || openPicker !== null) return;
          const mod = e.ctrlKey || e.metaKey;
          if (mod && e.key === "Enter" && !e.altKey) {
            e.preventDefault();
            submit(e.shiftKey ? "run" : "paste");
          } else if (mod && e.shiftKey && e.key.toLowerCase() === "c") {
            e.preventDefault();
            submit("copy");
          }
        }}
      >
        <DialogHeader className="flex-row items-start gap-3 px-5 pt-5 pb-4 text-left">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
            <SquareTerminal className="size-4" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <DialogTitle className="text-base">{template?.name ?? "テンプレート"}</DialogTitle>
            <DialogDescription className={cn(!template?.description && "sr-only")}>
              {template?.description || "差し替える部分を入力して、アクティブなタブへ入力する"}
            </DialogDescription>
          </div>
        </DialogHeader>

        {template === null ? (
          <div className="flex items-center gap-2 px-5 pb-6 text-sm text-muted-foreground">
            <Spinner />
            候補を読み込み中…
          </div>
        ) : (
          <>
            <div
              aria-label="送るコマンド"
              className="mx-5 rounded-md border bg-muted/40 px-3 py-2.5 font-mono text-sm leading-relaxed break-all whitespace-pre-wrap text-muted-foreground"
            >
              {segments.map((segment, index) => {
                if (segment.kind === "text") return <span key={index}>{segment.text}</span>;
                const field = fieldByName.get(segment.name);
                const value = values[segment.name] ?? "";
                const shown =
                  value === ""
                    ? `<${segment.name}>`
                    : field?.quote === false
                      ? value
                      : quoteShellArg(value);
                return (
                  <span
                    key={index}
                    className={cn(
                      "rounded-xs px-1",
                      focused === segment.name
                        ? "bg-primary/20 text-foreground ring-1 ring-primary/60"
                        : value === ""
                          ? "bg-warning/10 text-warning italic"
                          : "bg-warning/10 text-warning",
                    )}
                  >
                    {shown}
                  </span>
                );
              })}
            </div>

            <div className="flex flex-col gap-4 px-5 pt-4 pb-2">
              {template.fields.map((field, index) => (
                <FieldRow
                  key={field.name}
                  field={field}
                  value={values[field.name] ?? ""}
                  invalid={attempted && (values[field.name] ?? "") === ""}
                  autoFocus={index === 0}
                  pickerOpen={openPicker === field.name}
                  onPickerOpenChange={(next) => setOpenPicker(next ? field.name : null)}
                  onChange={(value) => setValue(field.name, value)}
                  onFocus={() => setFocused(field.name)}
                  registerRef={(el) => {
                    if (el) fieldRefs.current.set(field.name, el);
                    else fieldRefs.current.delete(field.name);
                  }}
                />
              ))}
            </div>
          </>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t px-5 py-3">
          <div className="flex flex-1 items-center gap-1.5 text-xs text-muted-foreground">
            <Kbd>Tab</Kbd>次の欄
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={template === null}
            onClick={() => submit("copy")}
          >
            コピー
            <Kbd>{modKeyLabel}+Shift+C</Kbd>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={template === null}
            onClick={() => submit("run")}
          >
            貼って実行
            <Kbd>{modKeyLabel}+Shift+Enter</Kbd>
          </Button>
          <Button size="sm" disabled={template === null} onClick={() => submit("paste")}>
            貼る
            <Kbd className="bg-primary-foreground/20 text-primary-foreground">
              {modKeyLabel}+Enter
            </Kbd>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface FieldRowProps {
  field: PreparedCommandTemplateField;
  value: string;
  invalid: boolean;
  autoFocus: boolean;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
  onFocus: () => void;
  registerRef: (el: HTMLElement | null) => void;
}

function FieldRow({
  field,
  value,
  invalid,
  autoFocus,
  pickerOpen,
  onPickerOpenChange,
  onChange,
  onFocus,
  registerRef,
}: FieldRowProps) {
  const id = `command-template-field-${field.name}`;
  const message =
    field.error ??
    (field.options !== null && field.options.length === 0 ? "選べる候補がありません" : null) ??
    (invalid ? "入力してください" : null);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-baseline gap-2 text-xs font-medium">
        {field.label}
        {field.label !== field.name && (
          <span className="font-mono font-normal text-muted-foreground">{field.name}</span>
        )}
      </label>
      {field.options === null ? (
        <Input
          id={id}
          ref={registerRef}
          autoFocus={autoFocus}
          value={value}
          placeholder={field.placeholder}
          aria-invalid={invalid || undefined}
          className="font-mono"
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
        />
      ) : (
        <OptionPicker
          id={id}
          options={field.options}
          value={value}
          invalid={invalid}
          autoFocus={autoFocus}
          open={pickerOpen}
          onOpenChange={onPickerOpenChange}
          onChange={onChange}
          onFocus={onFocus}
          registerRef={registerRef}
        />
      )}
      {message !== null && (
        <p
          className={cn(
            "text-xs",
            invalid || field.error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {message}
        </p>
      )}
    </div>
  );
}

interface OptionPickerProps {
  id: string;
  options: NonNullable<PreparedCommandTemplateField["options"]>;
  value: string;
  invalid: boolean;
  autoFocus: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
  onFocus: () => void;
  registerRef: (el: HTMLElement | null) => void;
}

function OptionPicker({
  id,
  options,
  value,
  invalid,
  autoFocus,
  open,
  onOpenChange,
  onChange,
  onFocus,
  registerRef,
}: OptionPickerProps) {
  const selected = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          ref={registerRef}
          autoFocus={autoFocus}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          disabled={options.length === 0}
          className="w-full min-w-0 justify-between font-normal"
          onFocus={onFocus}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              onOpenChange(true);
            }
          }}
        >
          <span className="min-w-0 truncate">{selected?.label ?? "選んでください"}</span>
          <span className="ml-auto flex max-w-1/3 min-w-0 items-center gap-2">
            {selected && (
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                {selected.value}
              </span>
            )}
            <ChevronsUpDown className="shrink-0 text-muted-foreground" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
        // 一覧はDialogContentの外（body直下）へ描かれるため、ここでも止めないとdocumentの
        // グローバルkeydownリスナーへ届いてPTYへ入力が漏れる
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Command
          // Tab・Shift+Tabで候補を上下に移す。一覧の中のフォーカスは絞り込み欄に留まったまま、
          // cmdkが↑↓キーで選択中の候補を切り替える作りのため、同じキーイベントを送り直して任せる
          onKeyDown={(e) => {
            if (e.key !== "Tab" || e.nativeEvent.isComposing || e.ctrlKey || e.altKey || e.metaKey)
              return;
            e.preventDefault();
            e.target.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: e.shiftKey ? "ArrowUp" : "ArrowDown",
                bubbles: true,
              }),
            );
          }}
        >
          <CommandInput placeholder="絞り込む…" />
          <CommandList>
            <CommandEmpty>見つかりません</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.value}
                // 同じlabelの候補を別物として扱えるよう、絞り込みの対象にvalueも含める
                value={`${option.label} ${option.value}`}
                onSelect={() => {
                  onChange(option.value);
                  onOpenChange(false);
                }}
              >
                <Check className={cn(option.value === value ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 truncate">{option.label}</span>
                {option.description && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {option.description}
                  </span>
                )}
                <span className="ml-auto max-w-1/3 min-w-0 truncate font-mono text-xs text-muted-foreground">
                  {option.value}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
