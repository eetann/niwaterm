import type { ResolvedSidebarToolbarItem } from "@niwaterm/config";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { SidebarToolbar } from "./sidebar-toolbar";

function item(overrides: Partial<ResolvedSidebarToolbarItem>): ResolvedSidebarToolbarItem {
  return {
    id: "item",
    builtin: null,
    icon: "",
    label: "",
    html: "",
    tooltip: "",
    color: "",
    dynamic: false,
    runnable: false,
    action: null,
    ...overrides,
  };
}

const commandPalette = item({ id: "right-0", builtin: "command-palette" });

const meta = {
  component: SidebarToolbar,
  decorators: [
    (Story) => (
      <div className="w-[240px] border">
        <Story />
      </div>
    ),
  ],
  args: {
    config: { visible: true, css: "", sections: { left: [], right: [commandPalette] } },
    values: {},
    reserveWindowControls: false,
    onOpenCommandPalette: fn(),
    onRunItem: fn(),
    onAction: fn(),
  },
} satisfies Meta<typeof SidebarToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 既定の並び。右端にコマンドパレットのボタンだけ */
export const Default: Story = {};

/** アイコンだけのボタン・文字付きのボタン・値を出すだけの部品を左右に並べる */
export const Customized: Story = {
  args: {
    config: {
      visible: true,
      css: "",
      sections: {
        left: [
          item({ id: "lazygit", icon: "git-branch", tooltip: "lazygitを開く", runnable: true }),
          item({ id: "notes", icon: "notebook-pen", label: "notes", runnable: true }),
          item({ id: "branch", icon: "git-branch", dynamic: true }),
        ],
        right: [
          commandPalette,
          item({ id: "quit", icon: "power", tooltip: "niwatermを終了", action: "quit-app" }),
        ],
      },
    },
    values: {
      branch: { text: "feat/sidebar-toolbar", html: "", tooltip: "", color: "" },
    },
  },
};

/** macOSでタイトルバーを隠したとき。ウィンドウ操作ボタンのぶん左の区画を空ける */
export const ReserveWindowControls: Story = {
  args: {
    ...Customized.args,
    reserveWindowControls: true,
  },
};

/** lucideに無いアイコン名は疑問符のアイコンで出す */
export const UnknownIcon: Story = {
  args: {
    config: {
      visible: true,
      css: "",
      sections: {
        left: [item({ id: "typo", icon: "git-brnch", runnable: true })],
        right: [commandPalette],
      },
    },
  },
};
