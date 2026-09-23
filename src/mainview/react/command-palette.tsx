import { FolderOpen, LayoutDashboard, Terminal } from "lucide-react";
import { useMemo } from "react";
import type { KeybindAction, ResolvedBoardStatus, ShellProfile } from "@niwaterm/config";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import type { BoardId } from "../../bun/workspace";
import type { WorkspaceId } from "../../bun/workspace-manager";
import {
  boardStatusActionDefs,
  COMMAND_PALETTE_ACTIONS,
  type CommandPaletteActionDef,
  type CommandPaletteCategory,
  sidebarViewActionDefs,
} from "../command-palette-actions";
import type { SidebarSwitcherView } from "./sidebar-switcher";

export type NonPaletteKeybindAction = Exclude<KeybindAction, "command-palette">;

/** 名前で選んで切り替えるBoard。next-board/prev-boardと違いワークスペースをまたいで並ぶ */
export interface CommandPaletteBoardItem {
  boardId: BoardId;
  label: string;
  /** 同名のBoardを見分けるための所属ワークスペース名 */
  workspaceLabel: string;
}

/** 名前で選んで切り替えるワークスペース */
export interface CommandPaletteWorkspaceItem {
  workspaceId: WorkspaceId;
  label: string;
  boardCount: number;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectAction: (action: NonPaletteKeybindAction) => void;
  /** シェルプロファイルを指定した新規タブ作成。タブバーの▼と同じ操作をキーボードだけで届かせる */
  shellProfiles: ShellProfile[];
  onSelectShellProfile: (shellProfileId: string) => void;
  /** サイドバーに出せるビュー。customViewが1つも無ければ切り替え先が無いので空で渡る */
  sidebarViews: SidebarSwitcherView[];
  /** Boardへ付けられるステータスの候補（board.statuses）。未定義なら項目が並ばない */
  boardStatuses: readonly ResolvedBoardStatus[];
  /** 切り替え先のBoard。アクティブなBoard自身は選んでも何も起きないので呼び出し側で除いて渡す */
  boards: readonly CommandPaletteBoardItem[];
  onSelectBoard: (boardId: BoardId) => void;
  /** 切り替え先のワークスペース。boardsと同じくアクティブなもの自身は含まない */
  workspaces: readonly CommandPaletteWorkspaceItem[];
  onSelectWorkspace: (workspaceId: WorkspaceId) => void;
  shortcutLabelFor: (action: NonPaletteKeybindAction) => string | undefined;
}

/**
 * アクション由来の項目と、実行時にしかラベルが決まらない項目（シェルプロファイル・Board・
 * ワークスペース）を同じ並びへ混ぜるためのタグ付きUnion
 */
type PaletteItem =
  | { kind: "action"; def: CommandPaletteActionDef }
  | { kind: "shellProfile"; profile: ShellProfile }
  | { kind: "board"; board: CommandPaletteBoardItem }
  | { kind: "workspace"; workspace: CommandPaletteWorkspaceItem };

/**
 * カテゴリ順はCOMMAND_PALETTE_ACTIONSの登場順のまま。シェルプロファイルは
 * new-tab系と並べたいので「タブ」カテゴリの末尾へ足す（そのカテゴリが無いことは無いが、
 * 無ければ新しいカテゴリとして末尾に出る）。Board・ワークスペースの切り替え先も同様に
 * それぞれのカテゴリの末尾へ足す。
 * サイドバーのビューはアクション由来の項目と同じ形に組み立ててから混ぜる
 */
function groupByCategory(
  defs: readonly CommandPaletteActionDef[],
  shellProfiles: readonly ShellProfile[],
  sidebarViews: readonly SidebarSwitcherView[],
  boardStatuses: readonly ResolvedBoardStatus[],
  boards: readonly CommandPaletteBoardItem[],
  workspaces: readonly CommandPaletteWorkspaceItem[],
): Map<CommandPaletteCategory, PaletteItem[]> {
  const map = new Map<CommandPaletteCategory, PaletteItem[]>();
  for (const def of [
    ...defs,
    ...boardStatusActionDefs(boardStatuses),
    ...sidebarViewActionDefs(sidebarViews),
  ]) {
    const list = map.get(def.category) ?? [];
    list.push({ kind: "action", def });
    map.set(def.category, list);
  }
  const tabItems = map.get("タブ") ?? [];
  for (const profile of shellProfiles) {
    tabItems.push({ kind: "shellProfile", profile });
  }
  map.set("タブ", tabItems);
  const boardItems = map.get("Board") ?? [];
  for (const board of boards) {
    boardItems.push({ kind: "board", board });
  }
  map.set("Board", boardItems);
  const workspaceItems = map.get("ワークスペース") ?? [];
  for (const workspace of workspaces) {
    workspaceItems.push({ kind: "workspace", workspace });
  }
  map.set("ワークスペース", workspaceItems);
  return map;
}

export function CommandPalette({
  open,
  onOpenChange,
  onSelectAction,
  shellProfiles,
  onSelectShellProfile,
  sidebarViews,
  boardStatuses,
  boards,
  onSelectBoard,
  workspaces,
  onSelectWorkspace,
  shortcutLabelFor,
}: CommandPaletteProps) {
  const grouped = useMemo(
    () =>
      groupByCategory(
        COMMAND_PALETTE_ACTIONS,
        shellProfiles,
        sidebarViews,
        boardStatuses,
        boards,
        workspaces,
      ),
    [shellProfiles, sidebarViews, boardStatuses, boards, workspaces],
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
              if (item.kind === "board") {
                const { board } = item;
                return (
                  <CommandItem
                    key={`board:${board.boardId}`}
                    // cmdkは選択中の項目をvalueの文字列で特定するため、valueが重複すると
                    // 先頭の項目だけが実行されてしまう。Board名はワークスペースをまたいで
                    // 重複しうるのでidまで含めて一意にする（表示はしない）。
                    // 所属ワークスペース名は下の説明にだけ出す（検索対象に含めると、
                    // Boardカテゴリが先に並ぶせいで「new workspace」等の検索が
                    // ワークスペース側のコマンドより先にBoardへ吸われる）
                    value={`Switch to Board: ${board.label} ${board.boardId}`}
                    keywords={[`Board「${board.label}」へ切り替え`]}
                    onSelect={() => {
                      onOpenChange(false);
                      onSelectBoard(board.boardId);
                    }}
                  >
                    <LayoutDashboard />
                    <div className="flex flex-col">
                      <span>Switch to Board: {board.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {board.workspaceLabel}のBoard「{board.label}」へ切り替え
                      </span>
                    </div>
                  </CommandItem>
                );
              }
              if (item.kind === "workspace") {
                const { workspace } = item;
                return (
                  <CommandItem
                    key={`workspace:${workspace.workspaceId}`}
                    // Board同様、ワークスペース名も重複しうるのでidまで含めて一意にする
                    value={`Switch to Workspace: ${workspace.label} ${workspace.workspaceId}`}
                    keywords={[`ワークスペース「${workspace.label}」へ切り替え`]}
                    onSelect={() => {
                      onOpenChange(false);
                      onSelectWorkspace(workspace.workspaceId);
                    }}
                  >
                    <FolderOpen />
                    <div className="flex flex-col">
                      <span>Switch to Workspace: {workspace.label}</span>
                      <span className="text-xs text-muted-foreground">
                        ワークスペース「{workspace.label}」へ切り替え（Board {workspace.boardCount}
                        個）
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
                  <Icon className={def.danger ? "text-amber-500" : undefined} />
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
