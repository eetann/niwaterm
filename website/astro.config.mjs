// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://eetann.github.io",
  // GitHub Pagesのプロジェクトページ（/niwaterm/配下）で公開する想定。後から変えると
  // ページ内の絶対パスのリンクがまとめて壊れるため、公開前から合わせておく
  base: "/niwaterm/",
  integrations: [
    starlight({
      title: "niwaterm",
      locales: {
        root: { label: "日本語", lang: "ja" },
      },
      sidebar: [
        {
          label: "はじめる",
          items: ["getting-started", "shell-integration"],
        },
        {
          label: "キーボード",
          items: ["keybindings", "keybindings/api", "keybindings/object-format", "jump-and-copy"],
        },
        { label: "見た目", items: ["appearance"] },
        {
          label: "Boardと画面",
          items: ["boards", "status-bar", "layouts", "layouts/project-local"],
        },
        { label: "ワークツリー", items: ["worktrees", "worktrees/hooks"] },
        { label: "マウスとリンク", items: ["mouse-and-links", "browser"] },
        { label: "拡張", items: ["custom-views", "hover-buttons", "bell"] },
        { label: "シェル", items: ["shell"] },
        { label: "AIエージェント", items: ["agents"] },
        { label: "CLI", items: ["cli", "cli/commands"] },
      ],
      logo: {
        light: "../docs/brand/logo.svg",
        dark: "../docs/brand/logo-dark.svg",
      },
      customCss: [
        "@fontsource/zen-kaku-gothic-antique/400.css",
        "@fontsource/zen-kaku-gothic-antique/700.css",
        "@fontsource/zen-kaku-gothic-antique/900.css",
        "@fontsource/spline-sans-mono/400.css",
        "@fontsource/spline-sans-mono/500.css",
        "./src/styles/brand.css",
      ],
      expressiveCode: {
        // コードブロックは両テーマとも暗い面にする（docs/brand/brand-guide.md）。
        // テーマを1つだけ渡すと明暗どちらでも同じ配色になる
        themes: ["github-dark"],
        styleOverrides: {
          borderRadius: "0",
          codeBackground: "var(--niwa-code-bg)",
          codeFontFamily: "var(--sl-font-mono)",
          uiFontFamily: "var(--sl-font)",
        },
      },
    }),
  ],
});
