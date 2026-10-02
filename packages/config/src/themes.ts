// appearance.themeで名前を指定して選べる組み込みの配色。
// ターミナルの色（foreground/background/cursor/ansiColors）はGhosttyに同梱されている同名テーマ
// （iTerm2-Color-Schemes由来）の値に揃える。catppuccin-mochaだけはbright色を通常色と同じにした
// Catppuccin公式の端末向け配色を使う。uiは各テーマの公式パレットから役割の近い色を選んでいる。

import type { ResolvedUiColors } from "./appearance";

/** テーマが決める色。appearanceの同名フィールドに書いた値はこれより優先される */
export interface ThemeColors {
  foreground: string;
  background: string;
  cursor: string;
  ansiColors: readonly string[];
  ui: ResolvedUiColors;
}

export interface BuiltinTheme {
  /** 一覧やStorybookのツールバーに出す表示名 */
  title: string;
  colors: ThemeColors;
}

export const builtinThemes = {
  "catppuccin-mocha": {
    title: "Catppuccin Mocha",
    colors: {
      foreground: "#cdd6f4",
      background: "#1e1e2e",
      cursor: "#f5e0dc",
      ansiColors: [
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
      ui: {
        border: "#313244",
        accent: "#89b4fa",
        warning: "#f9e2af",
        success: "#a6e3a1",
        danger: "#f38ba8",
        badgeForeground: "#1e1e2e",
        scrollbar: "#45475a",
      },
    },
  },
  "tokyo-night": {
    title: "Tokyo Night",
    colors: {
      foreground: "#c0caf5",
      background: "#1a1b26",
      cursor: "#c0caf5",
      ansiColors: [
        "#15161e",
        "#f7768e",
        "#9ece6a",
        "#e0af68",
        "#7aa2f7",
        "#bb9af7",
        "#7dcfff",
        "#a9b1d6",
        "#414868",
        "#f7768e",
        "#9ece6a",
        "#e0af68",
        "#7aa2f7",
        "#bb9af7",
        "#7dcfff",
        "#c0caf5",
      ],
      ui: {
        border: "#292e42",
        accent: "#7aa2f7",
        warning: "#e0af68",
        success: "#9ece6a",
        danger: "#f7768e",
        badgeForeground: "#1a1b26",
        scrollbar: "#3b4261",
      },
    },
  },
  dracula: {
    title: "Dracula",
    colors: {
      foreground: "#f8f8f2",
      background: "#282a36",
      cursor: "#f8f8f2",
      ansiColors: [
        "#21222c",
        "#ff5555",
        "#50fa7b",
        "#f1fa8c",
        "#bd93f9",
        "#ff79c6",
        "#8be9fd",
        "#f8f8f2",
        "#6272a4",
        "#ff6e6e",
        "#69ff94",
        "#ffffa5",
        "#d6acff",
        "#ff92df",
        "#a4ffff",
        "#ffffff",
      ],
      ui: {
        border: "#44475a",
        accent: "#bd93f9",
        warning: "#f1fa8c",
        success: "#50fa7b",
        danger: "#ff5555",
        badgeForeground: "#282a36",
        scrollbar: "#6272a4",
      },
    },
  },
  nord: {
    title: "Nord",
    colors: {
      foreground: "#d8dee9",
      background: "#2e3440",
      cursor: "#eceff4",
      ansiColors: [
        "#3b4252",
        "#bf616a",
        "#a3be8c",
        "#ebcb8b",
        "#81a1c1",
        "#b48ead",
        "#88c0d0",
        "#e5e9f0",
        "#596377",
        "#bf616a",
        "#a3be8c",
        "#ebcb8b",
        "#81a1c1",
        "#b48ead",
        "#8fbcbb",
        "#eceff4",
      ],
      ui: {
        border: "#3b4252",
        accent: "#88c0d0",
        warning: "#ebcb8b",
        success: "#a3be8c",
        danger: "#bf616a",
        badgeForeground: "#2e3440",
        scrollbar: "#4c566a",
      },
    },
  },
  "gruvbox-dark": {
    title: "Gruvbox Dark",
    colors: {
      foreground: "#ebdbb2",
      background: "#282828",
      cursor: "#ebdbb2",
      ansiColors: [
        "#282828",
        "#cc241d",
        "#98971a",
        "#d79921",
        "#458588",
        "#b16286",
        "#689d6a",
        "#a89984",
        "#928374",
        "#fb4934",
        "#b8bb26",
        "#fabd2f",
        "#83a598",
        "#d3869b",
        "#8ec07c",
        "#ebdbb2",
      ],
      ui: {
        border: "#3c3836",
        accent: "#83a598",
        warning: "#fabd2f",
        success: "#b8bb26",
        danger: "#fb4934",
        badgeForeground: "#282828",
        scrollbar: "#504945",
      },
    },
  },
  "gruvbox-light": {
    title: "Gruvbox Light",
    colors: {
      foreground: "#3c3836",
      background: "#fbf1c7",
      cursor: "#3c3836",
      ansiColors: [
        "#fbf1c7",
        "#cc241d",
        "#98971a",
        "#d79921",
        "#458588",
        "#b16286",
        "#689d6a",
        "#7c6f64",
        "#928374",
        "#9d0006",
        "#79740e",
        "#b57614",
        "#076678",
        "#8f3f71",
        "#427b58",
        "#3c3836",
      ],
      ui: {
        border: "#ebdbb2",
        accent: "#076678",
        warning: "#b57614",
        success: "#79740e",
        danger: "#9d0006",
        badgeForeground: "#fbf1c7",
        scrollbar: "#d5c4a1",
      },
    },
  },
  "solarized-light": {
    title: "Solarized Light",
    colors: {
      foreground: "#657b83",
      background: "#fdf6e3",
      cursor: "#657b83",
      ansiColors: [
        "#073642",
        "#dc322f",
        "#859900",
        "#b58900",
        "#268bd2",
        "#d33682",
        "#2aa198",
        "#bbb5a2",
        "#002b36",
        "#cb4b16",
        "#586e75",
        "#657b83",
        "#839496",
        "#6c71c4",
        "#93a1a1",
        "#fdf6e3",
      ],
      ui: {
        border: "#eee8d5",
        accent: "#268bd2",
        warning: "#b58900",
        success: "#859900",
        danger: "#dc322f",
        badgeForeground: "#fdf6e3",
        scrollbar: "#93a1a1",
      },
    },
  },
} satisfies Record<string, BuiltinTheme>;

export type ThemeName = keyof typeof builtinThemes;

export const DEFAULT_THEME: ThemeName = "catppuccin-mocha";

export function isThemeName(value: unknown): value is ThemeName {
  return typeof value === "string" && Object.hasOwn(builtinThemes, value);
}
