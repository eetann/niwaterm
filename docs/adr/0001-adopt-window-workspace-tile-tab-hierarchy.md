---
type: ADR
title: "ADR 0001: 画面構成の概念を Window > Workspace > Tile > Tab の4階層とする"
description: 画面・作業単位の概念と名前をWindow > Workspace > Tile > Tabの4階層に確定する意思決定
---

# ADR 0001: 画面構成の概念を Window > Workspace > Tile > Tab の4階層とする

## Status

Accepted

## Context

niwaterm はターミナル・マルチプレクサ・ワークスペース統合デスクトップアプリであり、ロードマップ上でペイン分割・タブ・セッション切り替え・サイドバー・CLI 操作を予定している。これらを実装する前に「画面や作業単位」の概念と名前を確定する必要がある。名前は UI 表示だけでなく、TypeScript 設定ファイルの型・CLI コマンド・IPC API の語彙として長期に固定されるため、後からの変更コストが大きい。

tmux の階層（Server > Session > Window > Pane)は「Window が OS ウィンドウではなくレイアウト1枚を指す」点が初心者に分かりづらいという課題意識があり、tmux・herdr・cmux・WezTerm の概念を調査した。

### 解決したい課題

- tmux の「Window」のような、一般的な語感（OS ウィンドウ）と乖離した名前を避けたい
- 「タブ」と「分割領域」の親子関係を決めたい（ツール間で流儀が割れている）
- 「Session」のように文脈で意味が変わる語（作業セット / サーバー名前空間）を階層名から排除したい

### 検討した選択肢

**構造（タブと分割領域の関係）:**

- 流派1: タブ = レイアウト1枚まるごと。タブ切り替えで画面全体の分割構成が入れ替わる（tmux / herdr / WezTerm / Zellij / iTerm2）
- 流派2: タブ = 分割領域の内部の切り替え単位。レイアウトは固定のまま各領域の中身だけ切り替わる（cmux / VS Code エディタグループ / Zed）

**分割領域の名前:**

- Pane / Split / Group / Tile

### 各選択肢の評価

構造:

| 観点 | 流派1（タブ＝レイアウト） | 流派2（タブ＝領域内切り替え） |
|------|--------------------------|------------------------------|
| 「画面全体を切り替える」役割 | タブが担う | Workspace（サイドバー）が担う |
| Workspace との役割重複 | 重複する | しない |
| AI エージェント運用（領域を固定して裏にログ等を置く） | 不向き | 適する |
| 先行例 | tmux, herdr, WezTerm, Zellij | cmux, VS Code, Zed |

分割領域の名前:

| 観点 | Pane | Split | Group | Tile |
|------|------|-------|-------|------|
| tmux ユーザーの誤解（pane=末端ターミナルという先入観） | あり | なし | なし | なし |
| 空間的なレイアウトのニュアンス | あり | あり | なし | あり |
| 「タブを内包する」ことの伝わりやすさ | 低 | 低 | 高 | 中 |
| 先行例 | cmux, Zed（流派2の意味で使用） | 操作名としては一般的 | VS Code (Editor Group) | タイリング WM 文化 |

## Decision

**画面構成を Window > Workspace > Tile > Tab の4階層とし、タブは分割領域（Tile）の内部に持つ流派2構造を採用する。**

### 1. 各概念の定義

```
Window（OS ウィンドウ。当面1つ）
└─ Workspace（プロジェクト単位のコンテナ。サイドバーに一覧され、
   │          切り替えるとタイルレイアウトごと入れ替わる）
   └─ Tile（分割領域。水平・垂直分割、フォーカス移動、リサイズの対象）
      └─ Tab（タイル内の切り替え単位。PTY またはブラウザ等を保持する末端）
```

- **PTY を保持する単位は Tab**。Tile はレイアウト構造のみを担う（タイル分割の初期実装ではタイルあたり Tab 1つでよいが、データ構造上 PTY は最初から Tab に紐づける）
- 「画面全体をガラッと切り替える」役割は Workspace が担うため、タブにその役割を持たせない

### 2. 流派2（タブ＝タイル内切り替え）の採用理由

- サイドバーの Workspace 一覧が「レイアウトごと切り替える」役割を既に担っており、流派1のタブは役割が重複する
- 「このタイルでエージェントを動かしつつ、裏のタブにログを置く」という AI エージェント常駐ワークフロー（docs/planning/mvp.md のコンセプト）に適合する

### 3. Tile という名前の採用理由

- タイリング WM 由来の語で「レイアウトを敷き詰める1枚」という空間イメージが正確
- tmux に Tile という階層名が存在せず、既存ユーザーの先入観と衝突しない（Pane は tmux では「末端のターミナル」を指すため、タブを内包する本設計では誤解を招く）
- 設定・CLI で短く書ける（例: `workspace.tiles[0].tabs[1]`）

### 4. 使わない語

- **Pane**: 階層名として使わない。tmux の意味（末端ターミナル）との混同を避ける
- **Session**: 階層名として使わない。「永続化・復元」や将来の IPC サーバーの名前空間の文脈に温存する

### 5. 他ツールとの対応表

| niwaterm | tmux | cmux | WezTerm | herdr |
|----------|------|------|---------|-------|
| Window | — | Window | Window | — |
| Workspace | Session | Workspace | Workspace | Workspace |
| Tile | ≒ Pane（位置） | Pane | ≒ Pane（位置） | ≒ Pane（位置） |
| Tab | ≒ Pane（PTY 保持者として） | Surface | — | — |

※ tmux/WezTerm/herdr の「Tab（tmux は Window）」はレイアウト1枚を指す流派1の概念であり、niwaterm の Tab とは役割が異なる。

## Consequences

### Positive

- 全階層が一般的な語感どおりに読める（Window = OS ウィンドウ、Tab = 領域内のタブ）ため初心者にとっつきやすい
- レイアウトを崩さずタブでプロセスを裏に待機させられ、AI エージェント常駐ワークフローに合う
- 設定ファイル・CLI・IPC API の語彙が短く一貫する

### Negative

- tmux ユーザーは「タブ切り替え＝レイアウト切り替え」を期待して戸惑う可能性がある
  - → README・ドキュメントに対応表（本 ADR §5）を掲載し、「レイアウト切り替えは Workspace」と明示する
- Tile はターミナル界隈で前例のない階層名のため初見では意味が伝わらない
  - → UI 上は分割操作（split）から自然に生まれる領域として見せ、用語解説を docs に置く

### Risks

- タイル分割の実装で PTY をタイルに直接持たせてしまうと、タブ実装時に載せ替えが発生する
  - → 本 ADR の定義どおり、最初から PTY は Tab（タイルあたり1つ）に紐づけて実装する
- ロードマップ・コンセプト文書に旧用語（ペイン・セッション）が残ると混乱する
  - → 本 ADR 採択と同時に roadmap.md / mvp.md / CLAUDE.md の用語を更新する

## 決めていないこと

| 項目 | 決めない理由 | いつ決めるか |
|------|------------|------------|
| Tab の中身（terminal / browser / HTML UI）の抽象名 | MVP では Tab = ターミナルのみで十分 | roadmap「GUI統合」セクション |
| Window の複数対応 | 当面1ウィンドウで進める | 必要になったとき |
| Workspace をさらに束ねる概念（cmux の Workspace Groups 相当） | サイドバー実装前に決めても空論になる | ADR 0006で決定（Board階層を追加） |
| 永続化の単位と「Session」の語の再利用 | 復元機能の実装時に具体化する | roadmap「タブとワークスペース」〜「磨き込みと配布」 |

## Notes

### 参考資料

- [herdr Concepts](https://herdr.dev/docs/concepts/) — Session > Workspace > Tab > Pane（流派1）
- [cmux Concepts](https://cmux.com/docs/concepts) — Window > Workspace > Pane > Surface（流派2）
- [WezTerm Multiplexing](https://wezterm.org/multiplexing.html) — Domain / Window > Tab > Pane + 横断的 Workspace
- docs/planning/mvp.md — niwaterm のコンセプト
