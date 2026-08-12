import type { ShellProfile } from "@niwaterm/config";
import { ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
}: TileTabBarProps) {
  return (
    <div className="flex w-full items-center">
      <Tabs value={activeTabId} onValueChange={onSelectTab} className="contents">
        <TabsList variant="line" className="h-7 w-fit shrink-0 justify-start p-0">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.tabId}
              value={tab.tabId}
              className="h-7 flex-none gap-1.5 px-2 text-xs"
            >
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
          ))}
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
