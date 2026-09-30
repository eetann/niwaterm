---
title: ベルと通知
description: BEL文字を受けたときの挙動の差し替えと、CLIからデスクトップ通知を出す方法
---

ターミナルがBEL文字（`0x07`）を出力すると、そのタブに「ベル」の印が付く。長いビルドの終わり（`make && printf '\a'`）やエージェントの応答待ちを、別のタブ・別のワークスペースを見ている間でも取りこぼさないための仕組み。

既定の挙動は2つ。

- **タブへのマーク**: タブバーとサイドバーのBoard行にベルのアイコンが出る。そのタブが画面に出た時点で自動的に消える（ウィンドウがフォーカスされていない間は、画面に出ていても消えない）
- **デスクトップ通知**: そのタブが今まさに画面に出ている時以外に出す（別Board・別ワークスペース・非アクティブタブ、またはniwatermのウィンドウが後ろにある場合）。目の前に出ているタブならマークだけで気づけるため通知しない。同じタブでベルが続く場合、通知は5秒間隔まで間引く（マークは常に付く）。macOSでは通知をクリックするとベルが鳴ったタブへ遷移する

ただし、そのタブの`agent_status`が`working`の間はマークも通知も出さない。エージェントは手が要らない途中経過でもBELを鳴らすため（Claude Codeは長いコマンドが一定時間を超えると鳴らす）、そのまま扱うと作業中ずっとベルが積もる。手が要る場面では`agent_status`が`blocked`（応答待ち）・`idle`（完了）へ変わり、サイドバーのバッジで分かる。`agent_status`は[エージェント統合](cli.md)のhooksが書き込むタブ変数で、hooksを入れていなければこの間引きは働かない。

## 処理を差し替える（`niwa.on("bell", ...)`）

`keybindings`の関数の中で`niwa.on("bell", handler)`を呼ぶと、**既定の処理の代わりに**そのハンドラが走る。

```ts
import { defineConfig } from "@niwaterm/config";

export default defineConfig({
  keybindings: (niwa) => {
    niwa.on("bell", (event) => {
      // 今見ていないワークスペースで鳴ったベルだけ通知する
      if (event.workspaceId !== niwa.workspace.current()) {
        niwa.notify({ title: "ベル", body: event.tabName ?? event.tabId, tabId: event.tabId });
      }
    });
  },
});
```

既定の挙動に何かを足したいだけなら、ハンドラの中から`niwa.bell.default(event)`を呼ぶ。

```ts
niwa.on("bell", (event) => {
  niwa.bell.default(event);
  niwa.tab.var.set(event.tabId, "bell_at", new Date().toLocaleTimeString());
});
```

ハンドラは`async`にでき、`niwa`のAPI（`notify`・`shell.run`・`tab.show`等）をそのまま使える。

## ハンドラに渡る値（`NiwaBellEvent`）

| フィールド                           | 型               | 意味                                                                                                         |
| ------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `tabId`                              | `string`         | ベルが鳴ったタブ                                                                                             |
| `tabName`                            | `string \| null` | サイドバーから設定したタブ名。未設定は`null`                                                                 |
| `tileId` / `boardId` / `workspaceId` | `string`         | そのタブの所在                                                                                               |
| `windowFocused`                      | `boolean`        | 鳴った時点でniwatermのウィンドウがフォーカスされていたか                                                     |
| `visible`                            | `boolean`        | 鳴った時点でそのタブが画面に出ていたか（別Board・別ワークスペース・非アクティブタブなら`false`）             |
| `agentStatus`                        | `string \| null` | 鳴った時点のタブ変数`agent_status`（`idle` / `working` / `blocked`）。エージェントが動いていないタブは`null` |

`agentStatus`を見れば、既定の処理と同じ間引きを自前のハンドラでも書ける。逆に作業中のベルも拾いたい場合は、`niwa.bell.default(event)`を呼ばず`niwa.bell.mark(event.tabId)`を直接呼ぶ。

## `niwa.bell`

| メソッド         | 意味                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `default(event)` | 既定の処理（マーク＋画面に出ていないタブなら通知。`agentStatus`が`working`なら何もしない）を実行する |
| `mark(tabId)`    | タブにマークを付ける。マークはそのタブが画面に出た時点で自動的に消える                               |
| `clear(tabId)`   | タブのマークを消す                                                                                   |

## デスクトップ通知を出す（`notify`）

```sh
niwaterm notify --title <title> [--body <body>] [--subtitle <subtitle>] [--silent] [--tab <tabId>]
```

OSのデスクトップ通知を出す。AIエージェントがタスク完了等をユーザーへ知らせる用途を想定（`--title`のみ必須）。macOSでは通知をクリックすると`--tab`のタブへ遷移する。`--tab`省略時はコマンドを実行したタブが遷移先になり、niwaterm外から実行した場合はクリックしても遷移しない。Windowsはクリックしても遷移しない。Windows実機ではElectrobun本体の通知APIが機能しない既知の不具合があり、PowerShell経由の代替実装を使っている（詳細: `docs/known-issues/windows-shell-notifyicon-not-registered.md`）。
