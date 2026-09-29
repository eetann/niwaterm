import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import type { ConfigSummary } from "../../bun/config-summary";
import { ConfigDialog } from "./config-dialog";

const loadedSummary: ConfigSummary = {
  configFile: "/home/user/.config/niwaterm/niwaterm.config.ts",
  configFileLoaded: true,
  loadError: null,
  diagnostics: [],
  sections: [
    {
      name: "appearance",
      entries: [
        { key: "fontFamily", value: '"HackGen Console NF", monospace' },
        { key: "fontSize", value: "15", note: "(ズーム中。設定値は13)" },
        { key: "foreground", value: "#cdd6f4", swatches: ["#cdd6f4"] },
        { key: "background", value: "#1e1e2e", swatches: ["#1e1e2e"] },
        {
          key: "ansiColors",
          value: "16色",
          swatches: [
            "#45475a",
            "#f38ba8",
            "#a6e3a1",
            "#f9e2af",
            "#89b4fa",
            "#f5c2e7",
            "#94e2d5",
            "#bac2de",
            "#585b70",
            "#f38ba8",
            "#a6e3a1",
            "#f9e2af",
            "#89b4fa",
            "#f5c2e7",
            "#94e2d5",
            "#a6adc8",
          ],
        },
      ],
    },
    {
      name: "keybindings",
      entries: [{ key: "prefix", value: "ctrl+b" }],
    },
    {
      name: "browser",
      entries: [{ key: "homepage", value: "(未設定)", note: "about:blankを開く" }],
    },
  ],
};

const meta = {
  component: ConfigDialog,
  args: {
    open: true,
    onOpenChange: fn(),
    summary: loadedSummary,
  },
} satisfies Meta<typeof ConfigDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** bunからconfigメッセージが届く前 */
export const Loading: Story = {
  args: { summary: null },
};

/** 設定ファイルが無く、全項目が既定値 */
export const NotLoaded: Story = {
  args: {
    summary: {
      ...loadedSummary,
      configFile: "/home/user/.config/niwaterm/niwaterm.config.ts",
      configFileLoaded: false,
    },
  },
};

/** ホットリロードで読み込みに失敗し、直前に読み込めた設定のまま動いている */
export const LoadErrorWithPreviousConfig: Story = {
  args: {
    summary: {
      ...loadedSummary,
      loadError: "SyntaxError: Unexpected token '}' (niwaterm.config.ts:42:3)",
    },
  },
};

/** 一部の設定を既定値へ落としたり無視したりした */
export const WithDiagnostics: Story = {
  args: {
    summary: {
      ...loadedSummary,
      diagnostics: [
        {
          level: "warn",
          scope: "appearance.fontSize",
          message: "正の数ではないため既定値(13)を使います",
        },
        {
          level: "error",
          scope: "customViews[1].path",
          message: "ファイルが見つかりません: ./views/todo.html",
        },
      ],
    },
  },
};
