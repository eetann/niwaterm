import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import type { SidebarBoardItem, SidebarWorkspaceItem } from "./sidebar-props";
import { SidebarWorkspaceList } from "./sidebar-workspace-list";

const COLLAPSED_WORKSPACES_STORAGE_KEY = "niwaterm:sidebarCollapsedWorkspaces";

function board(overrides: Partial<SidebarBoardItem> & Pick<SidebarBoardItem, "boardId">) {
  return {
    label: overrides.boardId,
    active: false,
    statusItems: [],
    agent: null,
    zoomed: false,
    bell: false,
    startup: null,
    worktreePath: null,
    worktreeMissing: false,
    phase: null,
    ...overrides,
  } satisfies SidebarBoardItem;
}

function workspace(
  overrides: Partial<SidebarWorkspaceItem> & Pick<SidebarWorkspaceItem, "workspaceId">,
) {
  return {
    label: overrides.workspaceId,
    active: false,
    boards: [],
    popup: null,
    ...overrides,
  } satisfies SidebarWorkspaceItem;
}

const branchLine = (value: string) =>
  ({ kind: "text", id: "builtin:branch", prefix: "on", color: null, value }) as const;

const meta = {
  component: SidebarWorkspaceList,
  decorators: [
    // index.cssの#sidebar系のIDセレクタで地の色・スクロールが決まるため、本番と同じ入れ子を再現する。
    // 幅はbodyのflex行の中でflex-basisとして効くものなので、flexでないプレビューでは明示する
    (Story) => (
      <aside id="sidebar" style={{ width: "var(--sidebar-width, 200px)", height: "100vh" }}>
        <div id="sidebar-body">
          <div id="sidebar-list">
            <Story />
          </div>
        </div>
      </aside>
    ),
  ],
  // 折りたたみ状態はlocalStorageへ保存されるため、ストーリー間で持ち越さない
  beforeEach: () => {
    localStorage.removeItem(COLLAPSED_WORKSPACES_STORAGE_KEY);
  },
  args: {
    workspaces: [
      workspace({
        workspaceId: "workspace-1",
        label: "niwaterm",
        active: true,
        boards: [board({ boardId: "board-1", label: "main", active: true })],
      }),
    ],
    boardPhases: [
      { id: "impl", label: "実装中", color: "#89b4fa" },
      { id: "review", label: "レビュー待ち", color: "#f9e2af" },
      { id: "done", label: "完了", color: null },
    ],
    onSetBoardPhase: fn(),
    onSelectWorkspaceHeader: fn(),
    onSelectBoard: fn(),
    onSelectPopup: fn(),
    onRenameBoard: fn(),
    onRenameWorkspace: fn(),
    onCloseBoard: fn(),
    onNewBoard: fn(),
    onNewWorkspace: fn(),
    onCloseWorkspace: fn(),
    onRequestBoardLayouts: async () => [
      { name: "dev", description: "エディタ・サーバー・ログの3分割", projectRoot: null },
      { name: "review", projectRoot: "/home/user/projects/niwaterm" },
      { name: "single", projectRoot: null, builtin: true },
    ],
    onApplyBoardLayout: fn(),
    onClearBoardStartup: fn(),
    onSetBoardWorktree: fn(),
    onMoveWorkspace: fn(),
    onMoveBoard: fn(),
    onMoveBoardToWorkspace: fn(),
  },
} satisfies Meta<typeof SidebarWorkspaceList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 起動直後。ワークスペース・Boardが1つずつでステータスラインも無い */
export const Default: Story = {};

/** 複数のワークスペースとBoard。アクティブでないワークスペースの見出しは薄く出る */
export const MultipleWorkspaces: Story = {
  args: {
    workspaces: [
      workspace({
        workspaceId: "workspace-1",
        label: "niwaterm",
        active: true,
        boards: [
          board({ boardId: "board-1", label: "main", active: true }),
          board({ boardId: "board-2", label: "feature/sidebar" }),
          board({ boardId: "board-3", label: "fix/scroll" }),
        ],
      }),
      workspace({
        workspaceId: "workspace-2",
        label: "dotfiles",
        boards: [board({ boardId: "board-4", label: "main" })],
      }),
      workspace({
        workspaceId: "workspace-3",
        label: "Workspace 3",
        boards: [board({ boardId: "board-5", label: "Board 1" })],
      }),
    ],
  },
};

/** ステータスラインの行の種類（ブランチ・エージェント状態・フェーズ・タブ変数）を全部出す */
export const StatusLines: Story = {
  args: {
    workspaces: [
      workspace({
        workspaceId: "workspace-1",
        label: "niwaterm",
        active: true,
        boards: [
          board({
            boardId: "board-1",
            label: "working",
            active: true,
            statusItems: [
              {
                kind: "phase",
                id: "builtin:phase",
                phase: { value: "impl", label: "実装中", color: "#89b4fa" },
              },
              branchLine("feature/storybook"),
              {
                kind: "agent",
                id: "builtin:agent",
                prefix: null,
                color: null,
                agent: { agent: "claude", status: "working", statusText: "Storybookを導入中" },
              },
            ],
          }),
          board({
            boardId: "board-2",
            label: "blocked",
            statusItems: [
              branchLine("fix/scroll"),
              {
                kind: "agent",
                id: "builtin:agent",
                prefix: null,
                color: null,
                agent: {
                  agent: "claude",
                  status: "blocked",
                  statusText: "Bashコマンドの実行許可を待っています。長い文は2行で切れて省略される",
                },
              },
            ],
          }),
          board({
            boardId: "board-3",
            label: "custom style",
            statusItems: [
              {
                kind: "phase",
                id: "builtin:phase",
                phase: { value: "レビュー依頼済み", label: "レビュー依頼済み", color: null },
              },
              { kind: "text", id: "tab-var:ticket", prefix: "#", color: "#f5c2e7", value: "1234" },
              {
                kind: "agent",
                id: "builtin:agent",
                prefix: "AI",
                color: "#a6e3a1",
                agent: { agent: "codex", status: "idle", statusText: "完了しました" },
              },
            ],
          }),
        ],
      }),
    ],
  },
};

/** Board名の横に付くアイコン（起動時レイアウト・ワークツリー消失・ズーム・ベル） */
export const BoardIcons: Story = {
  args: {
    workspaces: [
      workspace({
        workspaceId: "workspace-1",
        label: "niwaterm",
        active: true,
        boards: [
          board({
            boardId: "board-1",
            label: "startup layout",
            active: true,
            startup: { preset: "dev", restoreMode: "layout", projectRoot: null },
          }),
          board({
            boardId: "board-2",
            label: "preset (restore)",
            startup: { preset: "review", restoreMode: "restore", projectRoot: null },
          }),
          board({
            boardId: "board-3",
            label: "worktree missing",
            worktreePath: "/home/user/projects/niwaterm@removed",
            worktreeMissing: true,
          }),
          board({ boardId: "board-4", label: "zoomed", zoomed: true }),
          board({ boardId: "board-5", label: "bell", bell: true }),
          board({
            boardId: "board-6",
            label: "all icons",
            startup: { preset: "dev", restoreMode: "layout", projectRoot: null },
            worktreeMissing: true,
            zoomed: true,
            bell: true,
          }),
        ],
      }),
    ],
  },
};

/** ポップアップのカード。表示中と最小化中で右端の表記が変わる */
export const Popup: Story = {
  args: {
    workspaces: [
      workspace({
        workspaceId: "workspace-1",
        label: "niwaterm",
        active: true,
        boards: [board({ boardId: "board-1", label: "main", active: true })],
        popup: { tabId: "tab-10", visible: true, label: "lazygit" },
      }),
      workspace({
        workspaceId: "workspace-2",
        label: "dotfiles",
        boards: [board({ boardId: "board-2", label: "main" })],
        popup: { tabId: "tab-11", visible: false, label: "htop" },
      }),
    ],
  },
};

/** 折りたたんだワークスペース。Board行とポップアップが隠れる */
export const CollapsedWorkspace: Story = {
  args: MultipleWorkspaces.args,
  beforeEach: () => {
    localStorage.setItem(COLLAPSED_WORKSPACES_STORAGE_KEY, JSON.stringify(["workspace-2"]));
  },
};

/** サイドバーの幅に収まらない名前。末尾が省略される */
export const LongNames: Story = {
  args: {
    workspaces: [
      workspace({
        workspaceId: "workspace-1",
        label: "とても長いワークスペース名がサイドバーの幅を超える場合",
        active: true,
        boards: [
          board({
            boardId: "board-1",
            label: "feature/very-long-branch-name-that-overflows-the-sidebar",
            active: true,
            statusItems: [branchLine("feature/very-long-branch-name-that-overflows-the-sidebar")],
          }),
        ],
      }),
    ],
  },
};
