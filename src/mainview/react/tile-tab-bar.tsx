import type { ShellProfile } from "@niwaterm/config";
import { ChevronDown, Plus } from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TabId, TileId } from "../../bun/tile-layout";

export interface TileTabBarTabItem {
  tabId: TabId;
  label: string;
}

export interface TileTabBarProps {
  tileId: TileId;
  tabs: TileTabBarTabItem[];
  activeTabId: TabId;
  shellProfiles: ShellProfile[];
  onSelectTab: (tabId: TabId) => void;
  onCloseTab: (tabId: TabId) => void;
  onAddTab: () => void;
  onAddTabWithProfile: (shellProfileId: string | undefined) => void;
  onRequestTerminalFocus: () => void;
  onRenameTab: (tabId: TabId, name: string) => void;
}

/**
 * Radix TabsTriggerはpointerdown/clickでタブ選択がトリガーされるため、内側の閉じるボタンは
 * onPointerDown/onClick両方でstopPropagationしないと、閉じる前に一瞬そのタブが選択されてしまう。
 */
function stopEventPropagation(e: { stopPropagation: () => void }): void {
  e.stopPropagation();
}

export function TileTabBar({
  tabs,
  activeTabId,
  shellProfiles,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onAddTabWithProfile,
  onRequestTerminalFocus,
  onRenameTab,
}: TileTabBarProps) {
  // 名前編集中のタブ。確定はEnterのみ、Escapeまたはフォーカス喪失時は変更を破棄する
  const [editingTabId, setEditingTabId] = useState<TabId | null>(null);
  const [editingValue, setEditingValue] = useState("");
  // 「名前を変更」選択によるメニュー閉じ時はinputへautoFocusさせたいため、
  // onCloseAutoFocus側でonRequestTerminalFocusを呼ばないようにするための一時フラグ
  const renamingViaMenuRef = useRef(false);

  function startEditing(tabId: TabId, currentLabel: string): void {
    setEditingTabId(tabId);
    setEditingValue(currentLabel);
  }

  function commitEditing(): void {
    if (!editingTabId) return;
    onRenameTab(editingTabId, editingValue);
    setEditingTabId(null);
    onRequestTerminalFocus();
  }

  function cancelEditing(): void {
    if (!editingTabId) return;
    setEditingTabId(null);
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
              <ContextMenu key={tab.tabId}>
                <ContextMenuTrigger asChild>
                  <TabsTrigger value={tab.tabId} className="h-7 flex-none gap-1.5 px-2 text-xs">
                    <span>{tab.label}</span>
                    <Button
                      asChild
                      variant="ghost"
                      size="icon-xs"
                      className="size-4 opacity-60 hover:opacity-100"
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
                </ContextMenuContent>
              </ContextMenu>
            ),
          )}
        </TabsList>
      </Tabs>
      <Button variant="ghost" size="icon-xs" onClick={onAddTab} title="新しいタブ">
        <Plus />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" title="シェルを選択">
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
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
