import type { ShellProfile } from "@niwaterm/config";
import { Bell, ChevronDown, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TabId, TileId } from "../../bun/tile-layout";

export interface TileTabBarTabItem {
  tabId: TabId;
  label: string;
  /** ベルが鳴ったまま未読か。そのタブを表示した時点で解除される */
  bell: boolean;
}

/** タブD&D移動用のdataTransfer MIMEタイプ。mainview/index.ts側のドロップハンドラと共有する */
export const TAB_DRAG_MIME = "application/x-niwaterm-tab";

export interface TabDragPayload {
  tabId: TabId;
  fromTileId: TileId;
}

export interface TileTabBarProps {
  tileId: TileId;
  tabs: TileTabBarTabItem[];
  activeTabId: TabId;
  /** このタイルがズーム表示中か。右クリックメニューのラベル出し分けに使う */
  zoomed: boolean;
  shellProfiles: ShellProfile[];
  /** 新しいタブ（new-tab）のショートカット表記。キーが割り当てられていなければundefined */
  newTabShortcut?: string;
  onSelectTab: (tabId: TabId) => void;
  onCloseTab: (tabId: TabId) => void;
  onAddTab: () => void;
  onAddTabWithProfile: (shellProfileId: string | undefined) => void;
  onRequestTerminalFocus: () => void;
  onRenameTab: (tabId: TabId, name: string) => void;
  onToggleZoom: () => void;
  /**
   * メニューを開いている・名前を編集している間だけtrue。オーバーレイ表示のタブバー
   * （タブ1つのタイル）を、マウスがタイル上端から離れても消さないための通知
   */
  onInteractiveChange?: (active: boolean) => void;
}

/**
 * TabsTriggerの見た目。shadcn既定のline下線はタブの5px下（after:bottom-[-5px]）へ出るが、
 * .tab-barはタブと同じ高さでoverflowを持つため、そのままではクリップされて表示されず、
 * アクティブ表示が文字色の濃淡だけになってしまう。下線をタブ下端の内側へ引き直す。
 */
const TAB_TRIGGER_CLASS =
  "h-7 flex-none gap-1.5 px-2 text-xs group-data-[orientation=horizontal]/tabs:after:bottom-0";

/**
 * 新しいタブ・シェル選択ボタンのツールチップ。下はタブの中身で、ブラウザタブならwebview
 * （ネイティブのオーバーレイ）の裏に隠れる。上はウィンドウ上端に接していることが多く、Radixが
 * 下へ反転させてしまうため、左（タブ列側）へ出す。隣のボタンやタブに被るので、ツールチップ自体は
 * ポインタを受けないようにする（Tooltip側のdisableHoverableContentと対）
 */
const TOOLTIP_CONTENT_CLASS = "pointer-events-none flex items-center gap-2";

/**
 * Radix TabsTriggerはpointerdown/clickでタブ選択がトリガーされるため、内側の閉じるボタンは
 * onPointerDown/onClick両方でstopPropagationしないと、閉じる前に一瞬そのタブが選択されてしまう。
 */
function stopEventPropagation(e: { stopPropagation: () => void }): void {
  e.stopPropagation();
}

export function TileTabBar({
  tileId,
  tabs,
  activeTabId,
  zoomed,
  shellProfiles,
  newTabShortcut,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onAddTabWithProfile,
  onRequestTerminalFocus,
  onRenameTab,
  onToggleZoom,
  onInteractiveChange,
}: TileTabBarProps) {
  // 名前編集中のタブ。確定はEnterのみ、Escapeまたはフォーカス喪失時は変更を破棄する
  const [editingTabId, setEditingTabId] = useState<TabId | null>(null);
  const [editingValue, setEditingValue] = useState("");
  // 「名前を変更」選択によるメニュー閉じ時はinputへautoFocusさせたいため、
  // onCloseAutoFocus側でonRequestTerminalFocusを呼ばないようにするための一時フラグ
  const renamingViaMenuRef = useRef(false);
  // メニュー・名前編集の同時進行数。「名前を変更」はメニューを閉じながら編集を始めるので
  // 一時的に2つ重なる（単なるbooleanだと、閉じた側の通知で編集中まで解除されてしまう）
  const interactiveCountRef = useRef(0);

  function changeInteractive(delta: number): void {
    const before = interactiveCountRef.current;
    const after = Math.max(0, before + delta);
    interactiveCountRef.current = after;
    if (before > 0 !== after > 0) onInteractiveChange?.(after > 0);
  }

  function startEditing(tabId: TabId, currentLabel: string): void {
    changeInteractive(1);
    setEditingTabId(tabId);
    setEditingValue(currentLabel);
  }

  function commitEditing(): void {
    if (!editingTabId) return;
    onRenameTab(editingTabId, editingValue);
    setEditingTabId(null);
    changeInteractive(-1);
    onRequestTerminalFocus();
  }

  function cancelEditing(): void {
    if (!editingTabId) return;
    setEditingTabId(null);
    changeInteractive(-1);
    onRequestTerminalFocus();
  }

  return (
    <div className="flex w-full items-center">
      <Tabs value={activeTabId} onValueChange={onSelectTab} className="contents">
        <TabsList variant="line" className="h-7 w-fit shrink-0 justify-start p-0">
          {tabs.map((tab) =>
            editingTabId === tab.tabId ? (
              <input
                key={tab.tabId}
                type="text"
                autoFocus
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onClick={stopEventPropagation}
                onBlur={cancelEditing}
                onKeyDown={(e) => {
                  stopEventPropagation(e);
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitEditing();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelEditing();
                  }
                }}
                className="h-7 w-20 flex-none rounded-md border border-ring bg-background px-2 text-xs text-foreground outline-none"
              />
            ) : (
              <ContextMenu
                key={tab.tabId}
                onOpenChange={(open) => changeInteractive(open ? 1 : -1)}
              >
                <ContextMenuTrigger asChild>
                  <TabsTrigger
                    value={tab.tabId}
                    draggable
                    // ジャンプヒント（jump-hintアクション）がラベルの置き場所を探すための目印。
                    // index.ts側がこの属性でタブのDOM要素を引く
                    data-hint-tab-id={tab.tabId}
                    // ContextMenuTrigger(asChild)は自身のdata-state(open/closed)を子へマージする
                    // ため、TabsTriggerが内部で付けるdata-state="active"が握り潰される。shadcnの
                    // タブの見た目（下線・文字色）はdata-state=activeを見ているので明示的に付け直す
                    data-state={tab.tabId === activeTabId ? "active" : "inactive"}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      const payload: TabDragPayload = { tabId: tab.tabId, fromTileId: tileId };
                      e.dataTransfer.setData(TAB_DRAG_MIME, JSON.stringify(payload));
                    }}
                    className={TAB_TRIGGER_CLASS}
                  >
                    {tab.bell && (
                      <Bell aria-label="ベル" className="size-3 shrink-0 text-amber-500" />
                    )}
                    <span>{tab.label}</span>
                    <Button
                      asChild
                      variant="ghost"
                      size="icon-xs"
                      className="size-4 opacity-60 hover:opacity-100"
                      draggable={false}
                      onPointerDown={stopEventPropagation}
                      onMouseDown={stopEventPropagation}
                      onClick={(e) => {
                        stopEventPropagation(e);
                        onCloseTab(tab.tabId);
                      }}
                    >
                      <span>×</span>
                    </Button>
                  </TabsTrigger>
                </ContextMenuTrigger>
                <ContextMenuContent
                  onCloseAutoFocus={(e) => {
                    e.preventDefault();
                    if (!renamingViaMenuRef.current) onRequestTerminalFocus();
                    renamingViaMenuRef.current = false;
                  }}
                >
                  <ContextMenuItem
                    onSelect={() => {
                      renamingViaMenuRef.current = true;
                      startEditing(tab.tabId, tab.label);
                    }}
                  >
                    名前を変更
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={onToggleZoom}>
                    {zoomed ? "ズームを解除" : "ズーム表示"}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ),
          )}
        </TabsList>
      </Tabs>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" onClick={onAddTab} aria-label="新しいタブ">
            <Plus />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left" className={TOOLTIP_CONTENT_CLASS}>
          新しいタブ
          {newTabShortcut && <Kbd>{newTabShortcut}</Kbd>}
        </TooltipContent>
      </Tooltip>
      <DropdownMenu onOpenChange={(open) => changeInteractive(open ? 1 : -1)}>
        <Tooltip disableHoverableContent>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="シェルを選択">
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="left" className={TOOLTIP_CONTENT_CLASS}>
            シェルを選択
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="start"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            onRequestTerminalFocus();
          }}
        >
          <DropdownMenuItem onClick={() => onAddTabWithProfile(undefined)}>
            デフォルト
          </DropdownMenuItem>
          {shellProfiles.map((profile) => (
            <DropdownMenuItem key={profile.id} onClick={() => onAddTabWithProfile(profile.id)}>
              {profile.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
