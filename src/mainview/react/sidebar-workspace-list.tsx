import {
  AlertTriangle,
  Bell,
  ChevronRight,
  FolderX,
  LayoutTemplate,
  Maximize2,
  PictureInPicture2,
} from "lucide-react";
import { useRef, useState } from "react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { ResolvedBoardPhase } from "@niwaterm/config";
import { cn } from "@/lib/utils";
import type { LayoutListEntry } from "../../bun/project-config";
import type { BoardId } from "../../bun/workspace";
import type { WorkspaceId } from "../../bun/workspace-manager";
import {
  type SidebarBoardItem,
  type SidebarBoardStatusLine,
  type SidebarDropPosition,
  sidebarDropIndex,
  type SidebarPopupItem,
  type SidebarWorkspaceItem,
} from "./sidebar-props";

/** サイドバーから選ばれたレイアウトプリセット。適用は既存タブを閉じるため、確認は呼び出し側が取る */
export interface SidebarApplyLayoutRequest {
  boardId: BoardId;
  boardLabel: string;
  preset: string;
  /** 選んだプリセットの解決元。プロジェクトローカルならtrustの確認も要る */
  projectRoot: string | null;
}

export interface SidebarWorkspaceListProps {
  workspaces: SidebarWorkspaceItem[];
  /** 右クリックメニューに並べるフェーズの候補（board.phases）。未定義なら候補なしの案内を出す */
  boardPhases: readonly ResolvedBoardPhase[];
  /** Board行の右クリックからの作業フェーズの切り替え。nullは解除 */
  onSetBoardPhase: (boardId: BoardId, phase: string | null) => void;
  onSelectWorkspaceHeader: (workspaceId: WorkspaceId) => void;
  onSelectBoard: (workspaceId: WorkspaceId, boardId: BoardId) => void;
  onSelectPopup: (workspaceId: WorkspaceId) => void;
  onRenameBoard: (boardId: BoardId, name: string) => void;
  onRenameWorkspace: (workspaceId: WorkspaceId, name: string) => void;
  onCloseBoard: (boardId: BoardId, name: string) => void;
  /** ワークスペース見出しの右クリックからのBoard追加。作成先はそのワークスペース */
  onNewBoard: (workspaceId: WorkspaceId) => void;
  onNewWorkspace: () => void;
  /** ワークスペース見出しの右クリックからのワークスペース削除。確認ダイアログは呼び出し側が出す */
  onCloseWorkspace: (workspaceId: WorkspaceId, name: string) => void;
  /** 起動時レイアウトのサブメニューを開いたときに、そのBoardから見えるプリセットを取り出す */
  onRequestBoardLayouts: (boardId: BoardId) => Promise<LayoutListEntry[]>;
  onApplyBoardLayout: (request: SidebarApplyLayoutRequest) => void;
  onClearBoardStartup: (boardId: BoardId) => void;
  /** Board行の右クリックからのワークツリー紐づけの変更。入力ダイアログはindex.ts側が出す */
  onSetBoardWorktree: (boardId: BoardId) => void;
  /** ワークスペース見出しのD&Dによる並び替え。toIndexは0始まりの移動先（bun側のmoveWorkspaceへそのまま渡る） */
  onMoveWorkspace: (workspaceId: WorkspaceId, toIndex: number) => void;
  /** Board行のD&Dによる並び替え。toIndexは所属ワークスペース内での0始まりの移動先 */
  onMoveBoard: (boardId: BoardId, toIndex: number) => void;
  /**
   * Board行を別ワークスペースへD&Dしたときの移動。toIndexは移動先ワークスペース内での0始まりの
   * 挿入位置。移動元が空になる場合の確認は呼び出し側が取る
   */
  onMoveBoardToWorkspace: (boardId: BoardId, workspaceId: WorkspaceId, toIndex: number) => void;
}

/** 起動時レイアウトのサブメニューに並べるプリセット。開くたびに取り直す（configはホットリロードされるため） */
type LayoutMenuState =
  | { boardId: BoardId; status: "loading" }
  | { boardId: BoardId; status: "ready"; entries: LayoutListEntry[] };

const COLLAPSED_WORKSPACES_STORAGE_KEY = "niwaterm:sidebarCollapsedWorkspaces";

/**
 * ワークスペース並び替えD&D用のdataTransfer MIMEタイプ。タブD&D（TAB_DRAG_MIME）・Board並び替えと
 * 別にすることで、タブをサイドバーへ落としても並び替えが起きず、ワークスペースをタイルへ落としても
 * タブ移動が起きず、ワークスペース見出しをBoard行へ落としてもBoardの並びが動かない
 */
const WORKSPACE_DRAG_MIME = "application/x-niwaterm-workspace";

/** Board並び替えD&D用のdataTransfer MIMEタイプ。WORKSPACE_DRAG_MIMEと分ける理由は同上 */
const BOARD_DRAG_MIME = "application/x-niwaterm-board";

interface WorkspaceDragPayload {
  workspaceId: WorkspaceId;
}

interface BoardDragPayload {
  boardId: BoardId;
  workspaceId: WorkspaceId;
}

/** ドラッグ中はガイド線を1本だけ出すため、ワークスペース行とBoard行で状態を共有する */
type SidebarDropTarget =
  | { kind: "workspace"; workspaceId: WorkspaceId; position: SidebarDropPosition }
  | { kind: "board"; boardId: BoardId; position: SidebarDropPosition }
  // Board行をワークスペース見出しへ落とす（そのワークスペースの末尾へ移す）。折りたたみ中の
  // ワークスペースはBoard行が無く、行間のガイド線を出しようがないので見出しごと強調する
  | { kind: "workspace-boards"; workspaceId: WorkspaceId };

/** ドロップ先の行の上半分なら手前、下半分なら後ろへ挿入する */
function dropPositionAt(e: React.DragEvent<HTMLElement>): SidebarDropPosition {
  const rect = e.currentTarget.getBoundingClientRect();
  return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

type EditingTarget = { kind: "board"; id: BoardId } | { kind: "workspace"; id: WorkspaceId };

/** Board行のツールチップ・アイコンのaria-label。`niwaterm list`の[startup:]/[preset:]表示と対応させる */
function startupLabel(startup: NonNullable<SidebarBoardItem["startup"]>): string {
  return startup.restoreMode === "layout"
    ? `起動時レイアウト: ${startup.preset}`
    : `プリセット: ${startup.preset}（起動時は骨格を復元）`;
}

function loadCollapsedIds<T extends string>(storageKey: string): Set<T> {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

function saveCollapsedIds(storageKey: string, collapsed: Set<string>): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...collapsed]));
  } catch {
    // 保存できなくても致命的ではない（次回起動時は全展開にフォールバックする）
  }
}

export function SidebarWorkspaceList({
  workspaces,
  boardPhases,
  onSetBoardPhase,
  onSelectWorkspaceHeader,
  onSelectBoard,
  onSelectPopup,
  onRenameBoard,
  onRenameWorkspace,
  onCloseBoard,
  onNewBoard,
  onNewWorkspace,
  onCloseWorkspace,
  onRequestBoardLayouts,
  onApplyBoardLayout,
  onClearBoardStartup,
  onSetBoardWorktree,
  onMoveWorkspace,
  onMoveBoard,
  onMoveBoardToWorkspace,
}: SidebarWorkspaceListProps) {
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<WorkspaceId>>(() =>
    loadCollapsedIds(COLLAPSED_WORKSPACES_STORAGE_KEY),
  );
  // 名前編集中のBoard/Workspace。確定はEnterのみ、Escapeまたはフォーカス喪失時は変更を破棄する
  const [editingTarget, setEditingTarget] = useState<EditingTarget | null>(null);
  const [editingValue, setEditingValue] = useState("");
  // コンテキストメニューは同時に1つしか開かないので、プリセット一覧の状態もBoard横断で1つ持てば足りる
  const [layoutMenu, setLayoutMenu] = useState<LayoutMenuState | null>(null);
  // 開いた直後に閉じて別Boardを開いた場合、先行リクエストの結果が後から届いて上書きするのを防ぐ
  const layoutRequestSeq = useRef(0);
  // D&D中に挿入位置のガイド線を出す対象。ドラッグが終わったら必ずnullへ戻す
  const [dropTarget, setDropTarget] = useState<SidebarDropTarget | null>(null);

  function openLayoutMenu(boardId: BoardId): void {
    const seq = ++layoutRequestSeq.current;
    setLayoutMenu({ boardId, status: "loading" });
    onRequestBoardLayouts(boardId)
      .then((entries) => {
        if (seq === layoutRequestSeq.current) {
          setLayoutMenu({ boardId, status: "ready", entries });
        }
      })
      .catch(() => {
        if (seq === layoutRequestSeq.current) {
          setLayoutMenu({ boardId, status: "ready", entries: [] });
        }
      });
  }

  function closeLayoutMenu(): void {
    layoutRequestSeq.current++;
    setLayoutMenu(null);
  }

  function toggleCollapsedWorkspace(workspaceId: WorkspaceId): void {
    setCollapsedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      saveCollapsedIds(COLLAPSED_WORKSPACES_STORAGE_KEY, next);
      return next;
    });
  }

  function handleWorkspaceDragOver(
    e: React.DragEvent<HTMLElement>,
    workspaceId: WorkspaceId,
  ): void {
    if (!e.dataTransfer.types.includes(WORKSPACE_DRAG_MIME)) return;
    // ブラウザ既定動作（drop不可）を上書きし、この位置でのdropを許可する
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const position = dropPositionAt(e);
    setDropTarget((prev) =>
      prev?.kind === "workspace" && prev.workspaceId === workspaceId && prev.position === position
        ? prev
        : { kind: "workspace", workspaceId, position },
    );
  }

  // Board行の上へのドロップは、同一ワークスペースなら並び替え・別ワークスペースならその位置への
  // 移動になる。dragover中はdataTransferの中身を読めない（ブラウザのprotected mode）ため、
  // どちらなのかはdrop時にpayloadを読んで初めて決まる。見た目のガイド線はどちらも同じ
  function handleBoardDragOver(e: React.DragEvent<HTMLElement>, boardId: BoardId): void {
    if (!e.dataTransfer.types.includes(BOARD_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const position = dropPositionAt(e);
    setDropTarget((prev) =>
      prev?.kind === "board" && prev.boardId === boardId && prev.position === position
        ? prev
        : { kind: "board", boardId, position },
    );
  }

  function handleBoardDrop(
    e: React.DragEvent<HTMLElement>,
    workspaceId: WorkspaceId,
    overIndex: number,
  ): void {
    const raw = e.dataTransfer.getData(BOARD_DRAG_MIME);
    const position = dropPositionAt(e);
    setDropTarget(null);
    if (!raw) return;
    e.preventDefault();
    let payload: BoardDragPayload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (payload.workspaceId !== workspaceId) {
      // 別ワークスペースからの移動は、移動元からBoardが抜けても移動先の並びは詰まらないため
      // sidebarDropIndex（自分を取り除いた後の位置へ補正する計算）は使わない
      onMoveBoardToWorkspace(
        payload.boardId,
        workspaceId,
        position === "before" ? overIndex : overIndex + 1,
      );
      return;
    }
    const boards = workspaces.find((w) => w.workspaceId === workspaceId)?.boards ?? [];
    const fromIndex = boards.findIndex((b) => b.boardId === payload.boardId);
    if (fromIndex === -1) return;
    const toIndex = sidebarDropIndex(fromIndex, overIndex, position);
    if (toIndex === null) return;
    onMoveBoard(payload.boardId, toIndex);
  }

  /** ワークスペース見出しへのBoardのドロップを許可する。挿入位置は常に末尾なので上下の判定は要らない */
  function handleWorkspaceHeaderBoardDragOver(
    e: React.DragEvent<HTMLElement>,
    workspaceId: WorkspaceId,
  ): void {
    if (!e.dataTransfer.types.includes(BOARD_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget((prev) =>
      prev?.kind === "workspace-boards" && prev.workspaceId === workspaceId
        ? prev
        : { kind: "workspace-boards", workspaceId },
    );
  }

  /** ワークスペース見出しへBoardを落とす。そのワークスペースの末尾へ移す（同じワークスペースなら末尾へ並び替え） */
  function handleWorkspaceHeaderBoardDrop(
    e: React.DragEvent<HTMLElement>,
    workspaceId: WorkspaceId,
  ): void {
    const raw = e.dataTransfer.getData(BOARD_DRAG_MIME);
    setDropTarget(null);
    if (!raw) return;
    e.preventDefault();
    let payload: BoardDragPayload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    const boards = workspaces.find((w) => w.workspaceId === workspaceId)?.boards ?? [];
    if (payload.workspaceId === workspaceId) {
      onMoveBoard(payload.boardId, boards.length - 1);
      return;
    }
    onMoveBoardToWorkspace(payload.boardId, workspaceId, boards.length);
  }

  function handleWorkspaceDrop(e: React.DragEvent<HTMLElement>, overIndex: number): void {
    const raw = e.dataTransfer.getData(WORKSPACE_DRAG_MIME);
    // dropTargetのstateではなくイベントから位置を取り直す（dragoverのsetStateが
    // 反映される前にdropが来ても、カーソル位置どおりの挿入先になるようにするため）
    const position = dropPositionAt(e);
    setDropTarget(null);
    if (!raw) return;
    e.preventDefault();
    let payload: WorkspaceDragPayload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    const fromIndex = workspaces.findIndex((w) => w.workspaceId === payload.workspaceId);
    if (fromIndex === -1) return;
    const toIndex = sidebarDropIndex(fromIndex, overIndex, position);
    if (toIndex === null) return;
    onMoveWorkspace(payload.workspaceId, toIndex);
  }

  function startEditing(target: EditingTarget, currentLabel: string): void {
    setEditingTarget(target);
    setEditingValue(currentLabel);
  }

  function commitEditing(): void {
    if (!editingTarget) return;
    if (editingTarget.kind === "board") {
      onRenameBoard(editingTarget.id, editingValue);
    } else {
      onRenameWorkspace(editingTarget.id, editingValue);
    }
    setEditingTarget(null);
  }

  function cancelEditing(): void {
    setEditingTarget(null);
  }

  function renderNameInput() {
    return (
      <input
        type="text"
        autoFocus
        value={editingValue}
        onChange={(e) => setEditingValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={cancelEditing}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commitEditing();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancelEditing();
          }
        }}
        className="w-full min-w-0 rounded border border-ring bg-background px-1 py-0.5 text-xs text-foreground outline-none"
      />
    );
  }

  /**
   * 起動時レイアウトのサブメニュー。プリセットを選ぶとその場でBoardへ適用し、同時に起動時
   * レイアウトとしても紐づける（CLIの`layout apply --replace --startup`）。次回起動を待たずに
   * 見えた方が「思っていたレイアウトと違う」に早く気づけるため、適用と紐づけは分けない。
   * 適用は既存タブを閉じる破壊的操作なので、確認ダイアログは呼び出し側（index.ts）が出す
   */
  function renderStartupLayoutMenu(board: SidebarBoardItem) {
    const startup = board.startup;
    const entries =
      layoutMenu?.boardId === board.boardId && layoutMenu.status === "ready"
        ? layoutMenu.entries
        : null;
    return (
      <ContextMenuSub
        onOpenChange={(open) => {
          if (open) openLayoutMenu(board.boardId);
          else closeLayoutMenu();
        }}
      >
        <ContextMenuSubTrigger>起動時レイアウト</ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-w-72">
          <ContextMenuLabel className="text-xs font-normal text-muted-foreground">
            選ぶと今すぐ適用し、次回の起動時も同じ構成にする
          </ContextMenuLabel>
          {entries === null && <ContextMenuItem disabled>読み込み中...</ContextMenuItem>}
          {entries?.length === 0 && (
            <ContextMenuItem disabled>プリセットがありません</ContextMenuItem>
          )}
          {entries?.map((entry) => (
            <ContextMenuCheckboxItem
              key={`${entry.projectRoot ?? ""}\u0000${entry.name}`}
              checked={startup?.preset === entry.name}
              title={
                entry.projectRoot ? `${entry.projectRoot}/.niwaterm/config.ts` : entry.description
              }
              onSelect={() =>
                onApplyBoardLayout({
                  boardId: board.boardId,
                  boardLabel: board.label,
                  preset: entry.name,
                  projectRoot: entry.projectRoot,
                })
              }
            >
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.projectRoot && (
                <span className="shrink-0 text-[10px] text-muted-foreground">project</span>
              )}
            </ContextMenuCheckboxItem>
          ))}
          {startup && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => onClearBoardStartup(board.boardId)}>
                紐づけを解除
              </ContextMenuItem>
            </>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
    );
  }

  /**
   * 作業フェーズのサブメニュー。設定（board.phases）の候補を並べ、今の値にチェックを付ける。
   * 候補に無い文字列（CLIで直接設定したもの）が付いている場合は、その値も一時的な項目として
   * 末尾に足す（チェックの付いた項目がどこにも無いと、今の状態が読み取れなくなるため）
   */
  function renderBoardPhaseMenu(board: SidebarBoardItem) {
    const current = board.phase;
    const isCustom = current !== null && !boardPhases.some((s) => s.id === current.value);
    return (
      <ContextMenuSub>
        <ContextMenuSubTrigger>フェーズ</ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-w-72">
          {boardPhases.length === 0 && !isCustom && (
            <ContextMenuItem disabled>設定のboard.phasesで候補を定義できます</ContextMenuItem>
          )}
          {boardPhases.map((phase) => (
            <ContextMenuCheckboxItem
              key={phase.id}
              checked={current?.value === phase.id}
              onSelect={() => onSetBoardPhase(board.boardId, phase.id)}
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: phase.color ?? "var(--ui-accent)" }}
              />
              <span className="min-w-0 flex-1 truncate">{phase.label}</span>
            </ContextMenuCheckboxItem>
          ))}
          {isCustom && current && (
            <ContextMenuCheckboxItem
              checked
              onSelect={() => onSetBoardPhase(board.boardId, current.value)}
            >
              <span className="min-w-0 flex-1 truncate">{current.label}</span>
            </ContextMenuCheckboxItem>
          )}
          {current && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => onSetBoardPhase(board.boardId, null)}>
                フェーズを解除
              </ContextMenuItem>
            </>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
    );
  }

  /**
   * ステータスラインの1行。並び・取捨選択・接頭辞・文字色は設定（sidebar.boardStatus）で決まり、
   * ここは渡された1行を描くだけ。色の指定が無い行はTailwindのクラスで既定色を当てる
   */
  function renderBoardStatusLine(line: SidebarBoardStatusLine) {
    if (line.kind === "phase") {
      return (
        <div key={line.id} className="flex">
          <span
            className="max-w-full truncate rounded px-1 font-sans font-semibold"
            style={{
              backgroundColor: line.phase.color ?? "var(--ui-accent)",
              color: "var(--ui-badge-fg)",
            }}
          >
            {line.phase.label}
          </span>
        </div>
      );
    }
    if (line.kind === "agent") {
      const blocked = line.agent.status === "blocked";
      return (
        <div key={line.id} className="flex gap-1.5">
          {line.prefix === null ? (
            blocked ? (
              <AlertTriangle className="mt-0.5 size-2.5 shrink-0 text-amber-500" />
            ) : (
              <span className="text-sky-400">❯</span>
            )
          ) : (
            <span className={cn("shrink-0", blocked ? "text-amber-500" : "text-sky-400")}>
              {line.prefix}
            </span>
          )}
          <span
            className={cn(
              "line-clamp-2",
              line.color === null && (blocked ? "text-amber-400/90" : "text-muted-foreground"),
            )}
            style={line.color === null ? undefined : { color: line.color }}
          >
            {line.agent.statusText}
          </span>
        </div>
      );
    }
    return (
      <div key={line.id} className="flex items-center gap-1.5 text-muted-foreground">
        {line.prefix !== null && <span className="shrink-0 text-blue-400/80">{line.prefix}</span>}
        <span
          className="min-w-0 truncate"
          style={line.color === null ? undefined : { color: line.color }}
        >
          {line.value}
        </span>
      </div>
    );
  }

  /**
   * Board行はTile/Tabを表示しない1行が既定（ADR 0006後の再設計）。ブランチ・エージェント状態が
   * 何も無ければ展開せず1行のまま終わる。何かあれば縦線ガイド付きでステータスラインを展開する
   * （Neovimのwinbar・Claude Codeのステータスライン相当。等幅フォントで「on <branch>」
   * 「❯/⚠ <statusText>」を表示する）
   */
  function renderBoardRow(
    workspaceId: WorkspaceId,
    board: SidebarBoardItem,
    boardIndex: number,
    canClose: boolean,
  ) {
    if (editingTarget?.kind === "board" && editingTarget.id === board.boardId) {
      return (
        <div key={board.boardId} className="px-1.5 py-1">
          {renderNameInput()}
        </div>
      );
    }
    const hasStatusLine = board.statusItems.length > 0;
    const dotClass =
      board.agent?.status === "working"
        ? "bg-blue-500 shadow-[0_0_4px] shadow-blue-500"
        : board.agent?.status === "blocked"
          ? "bg-amber-500 shadow-[0_0_4px] shadow-amber-500"
          : "bg-muted-foreground/30";
    const dropPosition =
      dropTarget?.kind === "board" && dropTarget.boardId === board.boardId
        ? dropTarget.position
        : null;
    const titleParts: string[] = [];
    if (board.phase) titleParts.push(board.phase.label);
    if (board.bell) titleParts.push("ベル");
    if (board.zoomed) titleParts.push("ズーム中");
    if (board.agent) titleParts.push(`${board.agent.agent}: ${board.agent.status}`);
    if (board.startup) titleParts.push(startupLabel(board.startup));
    if (board.worktreeMissing)
      titleParts.push(`ワークツリーが見つかりません: ${board.worktreePath}`);
    return (
      <ContextMenu key={board.boardId}>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            tabIndex={-1}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              const payload: BoardDragPayload = { boardId: board.boardId, workspaceId };
              e.dataTransfer.setData(BOARD_DRAG_MIME, JSON.stringify(payload));
            }}
            // ドロップに至らずドラッグが終了した場合（Escapeでのキャンセル等）もガイド線を消す
            onDragEnd={() => setDropTarget(null)}
            onDragOver={(e) => handleBoardDragOver(e, board.boardId)}
            onDrop={(e) => handleBoardDrop(e, workspaceId, boardIndex)}
            data-hint-board-id={board.boardId}
            onClick={() => onSelectBoard(workspaceId, board.boardId)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              startEditing({ kind: "board", id: board.boardId }, board.label);
            }}
            className={cn(
              // ガイド線は透明なborderの色替えで出す（ワークスペース行と同じ理由）
              "flex w-full flex-col rounded-md border-y-2 border-transparent text-left transition-colors hover:bg-accent",
              board.active && "bg-accent",
              dropPosition === "before" && "border-t-sky-400",
              dropPosition === "after" && "border-b-sky-400",
            )}
            title={titleParts.length > 0 ? titleParts.join(" / ") : undefined}
          >
            <div className="flex w-full items-center gap-1.5 px-1.5 py-1">
              <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", dotClass)} />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold">{board.label}</span>
              {board.startup && (
                <LayoutTemplate
                  aria-label={startupLabel(board.startup)}
                  className={cn(
                    "size-3 shrink-0",
                    // 起動時に組み直すBoardだけ色を付ける。プリセット名を覚えているだけの
                    // Boardは起動時の見た目が変わらないため、区別が付く程度に落とす
                    board.startup.restoreMode === "layout"
                      ? "text-sky-400"
                      : "text-muted-foreground/40",
                  )}
                />
              )}
              {board.worktreeMissing && (
                <FolderX
                  aria-label="ワークツリーが見つかりません"
                  className="size-3 shrink-0 text-amber-500"
                />
              )}
              {board.zoomed && (
                <Maximize2
                  aria-label="ズーム中"
                  className="size-3 shrink-0 text-muted-foreground"
                />
              )}
              {board.bell && <Bell aria-label="ベル" className="size-3 shrink-0 text-amber-500" />}
            </div>
            {hasStatusLine && (
              <div className="flex w-full gap-1.5 px-1.5 pb-1.5">
                <div className="ml-[3px] w-0.5 shrink-0 rounded-full bg-muted-foreground/20" />
                <div className="min-w-0 flex-1 font-mono text-[10px] leading-relaxed">
                  {board.statusItems.map((line) => renderBoardStatusLine(line))}
                </div>
              </div>
            )}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onSelect={() => startEditing({ kind: "board", id: board.boardId }, board.label)}
          >
            名前を変更
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onSetBoardWorktree(board.boardId)}>
            ワークツリーを設定
          </ContextMenuItem>
          {renderBoardPhaseMenu(board)}
          {renderStartupLayoutMenu(board)}
          <ContextMenuItem
            variant="destructive"
            disabled={!canClose}
            onSelect={() => onCloseBoard(board.boardId, board.label)}
          >
            削除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  /**
   * ポップアップ（ADR 0005）はTile/Board木構造の外側にある一時的な状態。BoardカードとはUI上でも
   * 明確に区別するため、破線の枠＋影で意図的に「浮いている」見た目にする
   */
  function renderPopupCard(workspaceId: WorkspaceId, popup: SidebarPopupItem) {
    return (
      <div className="mt-2 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 px-1">
          <div className="h-px flex-1 bg-border" />
          <span className="shrink-0 text-[8px] font-bold tracking-wider text-muted-foreground/70">
            POPUP
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <button
          type="button"
          tabIndex={-1}
          data-hint-popup-workspace-id={workspaceId}
          onClick={() => onSelectPopup(workspaceId)}
          title={popup.visible ? undefined : "最小化中のポップアップ（クリックで再表示）"}
          className="flex items-center gap-1.5 rounded-xl border border-dashed border-muted-foreground/30 bg-accent/40 px-2.5 py-1.5 text-left shadow-md transition-colors hover:bg-accent"
        >
          <PictureInPicture2 className="size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{popup.label}</span>
          <span className="shrink-0 text-[9px] text-muted-foreground">
            {popup.visible ? "popup" : "最小化"}
          </span>
        </button>
      </div>
    );
  }

  return (
    <>
      {workspaces.map((workspace, workspaceIndex) => {
        const isWorkspaceCollapsed = collapsedWorkspaces.has(workspace.workspaceId);
        const isEditingThisWorkspace =
          editingTarget?.kind === "workspace" && editingTarget.id === workspace.workspaceId;
        const dropPosition =
          dropTarget?.kind === "workspace" && dropTarget.workspaceId === workspace.workspaceId
            ? dropTarget.position
            : null;
        const isBoardDropHeader =
          dropTarget?.kind === "workspace-boards" &&
          dropTarget.workspaceId === workspace.workspaceId;
        return (
          <div
            key={workspace.workspaceId}
            onDragOver={(e) => handleWorkspaceDragOver(e, workspace.workspaceId)}
            onDrop={(e) => handleWorkspaceDrop(e, workspaceIndex)}
            // ガイド線は透明なborderの色替えで出す（要素の追加・高さの変化で行がずれないようにするため）
            className={cn(
              "border-y-2 border-transparent",
              dropPosition === "before" && "border-t-sky-400",
              dropPosition === "after" && "border-b-sky-400",
            )}
          >
            {/*
              区切り線はドロップ判定を途切れさせないようワークスペース枠の内側へ置く。
              兄弟要素として枠の外へ出すと、その1px分がどのワークスペースにも属さない帯になる
            */}
            {workspaceIndex > 0 && <div className="mx-1 mb-1 h-px bg-border" />}
            {/*
              見出し行はBoardの受け皿も兼ねる（落とすとそのワークスペースの末尾へ移る）。
              折りたたみ中はBoard行が無く、行間へ落とす手段が他に無いため
            */}
            <div
              onDragOver={(e) => handleWorkspaceHeaderBoardDragOver(e, workspace.workspaceId)}
              onDrop={(e) => handleWorkspaceHeaderBoardDrop(e, workspace.workspaceId)}
              className={cn(
                "flex w-full items-center gap-1 rounded-md py-1.5 pr-2 pl-1",
                isBoardDropHeader && "bg-sky-400/20 ring-1 ring-sky-400",
              )}
            >
              <button
                type="button"
                tabIndex={-1}
                onClick={() => toggleCollapsedWorkspace(workspace.workspaceId)}
                className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronRight
                  className={cn(
                    "size-3 transition-transform",
                    !isWorkspaceCollapsed && "rotate-90",
                  )}
                />
              </button>
              {isEditingThisWorkspace ? (
                <div className="min-w-0 flex-1">{renderNameInput()}</div>
              ) : (
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <button
                      type="button"
                      tabIndex={-1}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        const payload: WorkspaceDragPayload = {
                          workspaceId: workspace.workspaceId,
                        };
                        e.dataTransfer.setData(WORKSPACE_DRAG_MIME, JSON.stringify(payload));
                      }}
                      // ドロップに至らずドラッグが終了した場合（Escapeでのキャンセル等）もガイド線を消す
                      onDragEnd={() => setDropTarget(null)}
                      data-hint-workspace-id={workspace.workspaceId}
                      onClick={() => onSelectWorkspaceHeader(workspace.workspaceId)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startEditing(
                          { kind: "workspace", id: workspace.workspaceId },
                          workspace.label,
                        );
                      }}
                      className={cn(
                        "min-w-0 flex-1 truncate text-left text-xs font-bold text-muted-foreground transition-colors hover:text-foreground",
                        workspace.active && "text-foreground",
                      )}
                    >
                      {workspace.label}
                    </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onSelect={() => onNewBoard(workspace.workspaceId)}>
                      新しいBoard
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => onNewWorkspace()}>
                      新しいワークスペース
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onSelect={() =>
                        startEditing(
                          { kind: "workspace", id: workspace.workspaceId },
                          workspace.label,
                        )
                      }
                    >
                      名前を変更
                    </ContextMenuItem>
                    <ContextMenuItem
                      variant="destructive"
                      // 最後の1つを閉じるとウィンドウごと畳むことになるためbun側が閉じない
                      disabled={workspaces.length === 1}
                      onSelect={() => onCloseWorkspace(workspace.workspaceId, workspace.label)}
                    >
                      削除
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              )}
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                {workspace.boards.length}
              </span>
            </div>
            {!isWorkspaceCollapsed && (
              <div className="flex flex-col gap-0.5 px-1.5 pb-1.5">
                {workspace.boards.map((board, boardIndex) =>
                  renderBoardRow(
                    workspace.workspaceId,
                    board,
                    boardIndex,
                    // 最後の1つでも、他にワークスペースがあればBoard 0個の状態で残せる。
                    // ワークスペースも1つだけなら閉じるとウィンドウごと畳むことになるため無効化する
                    workspace.boards.length > 1 || workspaces.length > 1,
                  ),
                )}
                {workspace.popup && renderPopupCard(workspace.workspaceId, workspace.popup)}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
