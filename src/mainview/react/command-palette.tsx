import { Terminal } from "lucide-react";
import { useMemo } from "react";
import type { KeybindAction, ShellProfile } from "@niwaterm/config";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  COMMAND_PALETTE_ACTIONS,
  type CommandPaletteActionDef,
  type CommandPaletteCategory,
  sidebarViewActionDefs,
} from "../command-palette-actions";
import type { SidebarSwitcherView } from "./sidebar-switcher";

export type NonPaletteKeybindAction = Exclude<KeybindAction, "command-palette">;

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectAction: (action: NonPaletteKeybindAction) => void;
  /** シェルプロファイルを指定した新規タブ作成。タブバーの▼と同じ操作をキーボードだけで届かせる */
  shellProfiles: ShellProfile[];
  onSelectShellProfile: (shellProfileId: string) => void;
  /** サイドバーに出せるビュー。customViewが1つも無ければ切り替え先が無いので空で渡る */
  sidebarViews: SidebarSwitcherView[];
  shortcutLabelFor: (action: NonPaletteKeybindAction) => string | undefined;
}

/** アクション由来の項目とシェルプロファイル由来の項目を同じ並びへ混ぜるためのタグ付きUnion */
type PaletteItem =
  | { kind: "action"; def: CommandPaletteActionDef }
  | { kind: "shellProfile"; profile: ShellProfile };

/**
 * カテゴリ順はCOMMAND_PALETTE_ACTIONSの登場順のまま。シェルプロファイルは
 * new-tab系と並べたいので「タブ」カテゴリの末尾へ足す（そのカテゴリが無いことは無いが、
 * 無ければ新しいカテゴリとして末尾に出る）。
 * サイドバーのビューはアクション由来の項目と同じ形に組み立ててから混ぜる
 */
function groupByCategory(
  defs: readonly CommandPaletteActionDef[],
  shellProfiles: readonly ShellProfile[],
  sidebarViews: readonly SidebarSwitcherView[],
): Map<CommandPaletteCategory, PaletteItem[]> {
  const map = new Map<CommandPaletteCategory, PaletteItem[]>();
  for (const def of [...defs, ...sidebarViewActionDefs(sidebarViews)]) {
    const list = map.get(def.category) ?? [];
    list.push({ kind: "action", def });
    map.set(def.category, list);
  }
  const tabItems = map.get("タブ") ?? [];
  for (const profile of shellProfiles) {
    tabItems.push({ kind: "shellProfile", profile });
  }
  map.set("タブ", tabItems);
  return map;
}

export function CommandPalette({
  open,
  onOpenChange,
  onSelectAction,
  shellProfiles,
  onSelectShellProfile,
  sidebarViews,
  shortcutLabelFor,
}: CommandPaletteProps) {
  const grouped = useMemo(
    () => groupByCategory(COMMAND_PALETTE_ACTIONS, shellProfiles, sidebarViews),
    [shellProfiles, sidebarViews],
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="コマンドを検索..." />
      <CommandList>
        <CommandEmpty>該当するコマンドがありません</CommandEmpty>
        {[...grouped.entries()].map(([category, items]) => (
          <CommandGroup key={category} heading={category}>
            {items.map((item) => {
              if (item.kind === "shellProfile") {
                const { profile } = item;
                return (
                  <CommandItem
                    key={`shell:${profile.id}`}
                    value={`New Tab: ${profile.name}`}
                    keywords={[`${profile.name}で新しいタブを開く`, profile.id, profile.command]}
                    onSelect={() => {
                      onOpenChange(false);
                      onSelectShellProfile(profile.id);
                    }}
                  >
                    <Terminal />
                    <div className="flex flex-col">
                      <span>New Tab: {profile.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {profile.name}で新しいタブを開く
                      </span>
                    </div>
                  </CommandItem>
                );
              }
              const { def } = item;
              const Icon = def.icon;
              const shortcut = shortcutLabelFor(def.action);
              return (
                <CommandItem
                  key={def.action}
                  value={def.labelEn}
                  keywords={def.keywords ? [def.label, ...def.keywords] : [def.label]}
                  onSelect={() => {
                    onOpenChange(false);
                    onSelectAction(def.action);
                  }}
                >
                  <Icon />
                  <div className="flex flex-col">
                    <span>{def.labelEn}</span>
                    <span className="text-xs text-muted-foreground">{def.label}</span>
                  </div>
                  {shortcut && <CommandShortcut>{shortcut}</CommandShortcut>}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
