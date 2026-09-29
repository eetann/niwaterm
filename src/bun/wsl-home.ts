// WSLディストロのタブのホームディレクトリ（Linuxパス）を引く。bun本体のhomedir()はWindows側の
// `C:\Users\<user>`なので、WSLタブが報告するcwd（`/home/<user>/...`）を`~`へ縮める判定に使えない。
// ディストロごとに1回だけwsl.exeで問い合わせてキャッシュする。ユーザーはプロファイルの`-u`を見ず、
// ディストロの既定ユーザーのホームを引く（自動検出するプロファイルは`wsl.exe -d <name>`だけのため）。

import { extractWslDistro } from "./wsl-cwd";

export interface WslHomeResolver {
  /**
   * 起動シェルコマンドがWSLプロファイルならそのディストロのホームを返す。
   * WSL以外・問い合わせ中・問い合わせ失敗はundefined。未問い合わせなら裏で問い合わせを始める
   */
  homeOf(shellCommand: string | undefined): string | undefined;
}

export interface CreateWslHomeResolverOptions {
  /** 問い合わせが終わってホームが分かった時に呼ぶ。表示を評価し直させる口 */
  onResolved(): void;
  /** ディストロのホームを問い合わせる。テストで差し替えられるよう引数化している */
  lookup?: (distro: string) => Promise<string | null>;
  platform?: NodeJS.Platform;
}

async function lookupWslHome(distro: string): Promise<string | null> {
  try {
    // `-e`はログインシェルを経由しないので、どのディストロにもある/bin/shの組み込みprintfで出す
    const proc = Bun.spawn(["wsl.exe", "-d", distro, "-e", "/bin/sh", "-c", 'printf %s "$HOME"'], {
      stdout: "pipe",
      stderr: "ignore",
      // 詳細: docs/known-issues/windows-spawn-console-window-steals-focus.md
      windowsHide: true,
    });
    // Linux側のプロセスが直接書く出力なので、wsl.exe自身のメッセージと違いUTF-8で届く
    const out = (await new Response(proc.stdout).text()).trim();
    if ((await proc.exited) !== 0 || !out.startsWith("/")) return null;
    return out;
  } catch (err) {
    console.log(`[bun] failed to look up WSL home of ${distro}: ${String(err)}`);
    return null;
  }
}

export function createWslHomeResolver(opts: CreateWslHomeResolverOptions): WslHomeResolver {
  const platform = opts.platform ?? process.platform;
  const lookup = opts.lookup ?? lookupWslHome;
  /** ディストロ名 → ホーム。問い合わせ中はundefined、失敗はnull（再問い合わせしない） */
  const homes = new Map<string, string | null | undefined>();

  return {
    homeOf(shellCommand) {
      if (platform !== "win32") return undefined;
      const distro = extractWslDistro(shellCommand);
      if (distro === null) return undefined;
      if (homes.has(distro)) return homes.get(distro) ?? undefined;
      homes.set(distro, undefined);
      void lookup(distro)
        .catch(() => null)
        .then((home) => {
          homes.set(distro, home);
          if (home !== null) opts.onResolved();
        });
      return undefined;
    },
  };
}
