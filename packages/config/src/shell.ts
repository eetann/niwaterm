// シェル設定。新規タブ作成時に使うデフォルトシェルをniwaterm.config.tsから変更できるようにする。
// appearance/browserと異なりOS共通の既定値が無い（既定はpty.ts側のOS判定に委ねる:
// macOS/Linuxは/bin/zsh、Windowsはpowershell.exe）ため、未指定時のResolved型は`undefined`のまま扱う。

export interface ShellProfile {
  /** プロファイルの一意識別子。CLIの--shellやタブ作成時のRPCで指定する（表示名ではなくこちらで指定する） */
  id: string;
  /** UIのドロップダウン等に表示する名前 */
  name: string;
  /** 実行コマンド（PATHから解決される） */
  command: string;
}

export interface ShellConfig {
  /** 新規タブ作成時に使うデフォルトシェルの実行コマンド（PATHから解決される）。未指定時はOS標準シェルを使う */
  default?: string;
  /**
   * 追加のシェルプロファイル一覧（PowerShell・SSH先など）。Windowsでは起動時に自動検出した
   * WSLディストロ・PowerShellのプロファイルとidベースでマージされる（同じidはこちらが優先）
   */
  profiles?: ShellProfile[];
}
