import type {
  KeybindAction,
  ResolvedSidebarToolbarConfig,
  ResolvedSidebarToolbarItem,
  StatusBarValue,
} from "@niwaterm/config";
import { CircleQuestionMark, icons, Search } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { NO_DRAG_REGION_CLASS } from "../drag-region";
import { lucideIconKey } from "../lucide-icon-name";

export interface SidebarToolbarProps {
  config: ResolvedSidebarToolbarConfig;
  /** source・renderを持つ部品の評価済みの値（部品id → 値） */
  values: Record<string, StatusBarValue>;
  /**
   * macOSでタイトルバーを隠しているか。ウィンドウ操作ボタンがツールバーの左端へ重なるので、
   * そのぶん左の区画を右へずらす
   */
  reserveWindowControls: boolean;
  onOpenCommandPalette: () => void;
  /** runを持つ部品が押された */
  onRunItem: (id: string) => void;
  onAction: (action: KeybindAction) => void;
}

function ToolbarIcon({ name }: { name: string }) {
  const Icon = icons[lucideIconKey(name) as keyof typeof icons] ?? CircleQuestionMark;
  return <Icon />;
}

function WithTooltip({ tooltip, children }: { tooltip: string; children: ReactNode }) {
  if (tooltip === "") return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

interface ItemDisplay {
  text: string;
  html: string;
  tooltip: string;
  color: string;
}

/** 部品に出す中身。source・renderの部品は値が空なら出さない（ステータスバーと同じく詰める） */
function displayOf(
  item: ResolvedSidebarToolbarItem,
  values: Record<string, StatusBarValue>,
): ItemDisplay | null {
  if (!item.dynamic) {
    return { text: item.label, html: item.html, tooltip: item.tooltip, color: item.color };
  }
  const value = values[item.id];
  if (value === undefined || (value.text === "" && value.html === "")) return null;
  return value;
}

function ToolbarItem({
  item,
  values,
  onOpenCommandPalette,
  onRunItem,
  onAction,
}: { item: ResolvedSidebarToolbarItem } & Pick<
  SidebarToolbarProps,
  "values" | "onOpenCommandPalette" | "onRunItem" | "onAction"
>) {
  if (item.builtin === "command-palette") {
    return (
      <WithTooltip tooltip="コマンドパレットを開く">
        <Button
          className={NO_DRAG_REGION_CLASS}
          variant="ghost"
          size="icon-xs"
          onClick={onOpenCommandPalette}
          aria-label="コマンドパレットを開く"
        >
          <Search />
        </Button>
      </WithTooltip>
    );
  }
  const display = displayOf(item, values);
  if (display === null) return null;
  const content = (
    <>
      {item.icon !== "" && <ToolbarIcon name={item.icon} />}
      {display.html !== "" ? (
        <span className="min-w-0 truncate" dangerouslySetInnerHTML={{ __html: display.html }} />
      ) : (
        display.text !== "" && <span className="min-w-0 truncate">{display.text}</span>
      )}
    </>
  );
  const style = display.color === "" ? undefined : { color: display.color };
  const iconOnly = display.text === "" && display.html === "";
  const { action } = item;
  if (!item.runnable && action === null) {
    return (
      <WithTooltip tooltip={display.tooltip}>
        <span
          className="flex min-w-0 items-center gap-1 px-1 text-xs text-muted-foreground [&_svg]:size-3 [&_svg]:shrink-0"
          style={style}
          data-toolbar-item={item.id}
        >
          {content}
        </span>
      </WithTooltip>
    );
  }
  return (
    <WithTooltip tooltip={display.tooltip}>
      <Button
        className={cn(NO_DRAG_REGION_CLASS, "min-w-0")}
        variant="ghost"
        size={iconOnly ? "icon-xs" : "xs"}
        style={style}
        data-toolbar-item={item.id}
        aria-label={display.tooltip || display.text || item.icon}
        onClick={() => {
          if (item.runnable) onRunItem(item.id);
          else if (action !== null) onAction(action);
        }}
      >
        {content}
      </Button>
    </WithTooltip>
  );
}

export function SidebarToolbar({
  config,
  values,
  reserveWindowControls,
  ...handlers
}: SidebarToolbarProps) {
  return (
    <div
      className={cn(
        "flex flex-none items-center gap-1 border-b px-1 py-1",
        // ボタンが1つも出ていなくてもツールバーの高さは保つ。タイトルバーを隠しているときは
        // ここがウィンドウのドラッグ領域になるため
        "min-h-8",
        reserveWindowControls && "pl-[72px]",
      )}
    >
      {config.css !== "" && <style>{config.css}</style>}
      {/* タイトルバー非表示時はツールバー全体がウィンドウのドラッグ領域になるため、
          ボタンだけはクリックを通す（ドラッグ領域でない通常時は何の影響も無い） */}
      <div className="flex min-w-0 items-center gap-0.5">
        {config.sections.left.map((item) => (
          <ToolbarItem key={item.id} item={item} values={values} {...handlers} />
        ))}
      </div>
      <div className="ml-auto flex shrink-0 items-center justify-end gap-0.5">
        {config.sections.right.map((item) => (
          <ToolbarItem key={item.id} item={item} values={values} {...handlers} />
        ))}
      </div>
    </div>
  );
}
