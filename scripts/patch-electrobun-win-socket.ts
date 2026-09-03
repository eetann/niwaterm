// preBuildフックで実行され、Hutchがプロジェクトへ投影したElectrobun SDK
// (.hutch/devkit/api/sdks/main/core/BrowserView.ts) の1行を書き換えて、
// Windowsでもbun→webviewのメッセージ送信にWebSocketトランスポートを使わせる。
//
// ElectrobunのSDKはWindowsに限りこのトランスポートを入口で無効化しており、代わりに
// 「メッセージのJSONをJSのソース文字列へ埋め込んでExecuteScriptで評価させる」フォールバック
// 経路を通る。niwatermは最大60fpsでアクティブBoardの全タブぶんのHTMLを送るため、この経路だと
// WebView2のbrowserプロセスが肥大し続ける（実機で713MBまで確認。フラグを外すと38MBで横ばい）。
//
// Windowsだけ無効化されているのは上流の
// https://github.com/blackboardsh/electrobun/issues/362
// （RPCサーバーが0.0.0.0にバインドしWindowsのファイアウォールプロンプトが出る）が理由。
// これは2026-08-02にクローズ済みで、2.xのコアは127.0.0.1にバインドするよう直っている。
// 実機でも127.0.0.1:50000でlistenし、webview側から接続済み（ESTABLISHED）なのを確認した。
// フラグだけが2.xの刷新コミットに持ち越されて残っている状態。
//
// .hutch/はgitignore対象かつHutchが再投影で作り直すため、リポジトリ側にパッチを置けない。
// mise.tomlのwin:syncも.hutchを同期対象から除外している（WSL側はlinux向けに投影された別物なので
// 正しい）ため、Windows側のビルド時に毎回当てる必要がある。
import { existsSync } from "node:fs";
import { join } from "node:path";

const TARGET = join(
	import.meta.dir,
	"..",
	".hutch",
	"devkit",
	"api",
	"sdks",
	"main",
	"core",
	"BrowserView.ts",
);
const BEFORE = 'const HOST_MESSAGE_SOCKET_AVAILABLE = process.platform !== "win32";';
const AFTER =
	"const HOST_MESSAGE_SOCKET_AVAILABLE = true; // patched by scripts/patch-electrobun-win-socket.ts";

if (process.platform !== "win32") {
	console.log("preBuild(patch-electrobun-win-socket): Windows以外なのでスキップ");
	process.exit(0);
}

if (!existsSync(TARGET)) {
	console.error(`preBuild(patch-electrobun-win-socket): 見つかりません: ${TARGET}`);
	process.exit(1);
}

const source = await Bun.file(TARGET).text();

if (source.includes(AFTER)) {
	console.log("preBuild(patch-electrobun-win-socket): 適用済み");
	process.exit(0);
}

// 想定の行が無い＝electrobunの更新でSDKの形が変わった可能性がある。黙って素通りさせると
// ExecuteScript経路へ戻ったことに気づけないので、ビルドを止めて気づけるようにする
if (!source.includes(BEFORE)) {
	console.error(
		`preBuild(patch-electrobun-win-socket): 想定の行が見つかりません。electrobunの更新で\n` +
			`SDKが変わった可能性があります。${TARGET} を確認し、必要ならこのスクリプトを直してください。\n` +
			`  探した行: ${BEFORE}`,
	);
	process.exit(1);
}

await Bun.write(TARGET, source.replace(BEFORE, AFTER));
console.log("preBuild(patch-electrobun-win-socket): WebSocketトランスポートを有効化");
