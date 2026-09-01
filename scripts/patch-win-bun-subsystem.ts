// postBuildフックで実行され、appバンドル内のbun.exeのPE Subsystemを
// WINDOWS_CUI(3)からWINDOWS_GUI(2)へ書き換える（Windowsでビルドした場合のみ）。
//
// electrobunのlauncher.exe自体はGUI subsystemだが、devチャンネルのビルドでは
// "Dev build detected - console output enabled"の分岐に入り、子のbun.exeを
// コンソール付きで起動する。ターミナルから起動した場合は親のコンソールへ
// アタッチするだけなので何も起きないが、Explorer（タスクバーのショートカット等）から
// 起動すると親コンソールが無いためbun.exeへ新しいコンソールが割り当てられ、
// 既定のターミナルアプリ（Windows 11ではWindows Terminal）のウィンドウが開いてしまう。
// そのウィンドウを閉じるとCTRL_CLOSE_EVENTでbun.exeごと終了するため、
// 「ターミナルを閉じるとniwatermも閉じる」状態になる。
//
// bun.exeをGUI subsystemにするとコンソールの自動割り当て自体が起きなくなる。
// 親がコンソールを持つ場合（`mise run start`経由）は標準出力をそのまま継承するため、
// 開発時のログ出力は失われない（Windows実機で確認済み）。
// 詳細: docs/known-issues/windows-taskbar-launch-opens-windows-terminal.md
import { Glob } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";

const SUBSYSTEM_WINDOWS_GUI = 2;
const SUBSYSTEM_WINDOWS_CUI = 3;
const PE_SIGNATURE = 0x00004550; // "PE\0\0"

/**
 * PEオプショナルヘッダのSubsystemフィールドのオフセットを返す。
 * DOSヘッダの0x3cにPEシグネチャ位置(e_lfanew)があり、その後ろのCOFFヘッダは20バイト固定。
 * Subsystemはオプショナルヘッダ先頭から68バイト目で、PE32とPE32+で位置は変わらない
 */
function subsystemOffset(view: DataView): number {
	const peOffset = view.getUint32(0x3c, true);
	if (view.getUint32(peOffset, true) !== PE_SIGNATURE) {
		throw new Error("PEシグネチャが見つからない");
	}
	return peOffset + 4 + 20 + 68;
}

if (process.platform !== "win32") {
	console.log("postBuild(patch-win-bun-subsystem): Windows以外なのでスキップ");
	process.exit(0);
}

// buildFolderはアプリ名(NIWATERM_APP_NAME)の有無で変わり、チャンネル・OS・アーキも
// パスに含まれるため、決め打ちせずbuild/配下のbun.exeを全て対象にする。
// 既にGUIになっているものは書き込まない（--watchの再ビルドで
// 起動中のbun.exeを掴んでEBUSYになるのを避けるため）
const buildRoot = join(import.meta.dir, "..", "build");
if (!existsSync(buildRoot)) {
	console.log("postBuild(patch-win-bun-subsystem): build/が無いのでスキップ");
	process.exit(0);
}
let patched = 0;

for await (const path of new Glob("**/bin/bun.exe").scan({ cwd: buildRoot, absolute: true })) {
	const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
	const view = new DataView(bytes.buffer);
	const offset = subsystemOffset(view);
	if (view.getUint16(offset, true) !== SUBSYSTEM_WINDOWS_CUI) continue;
	view.setUint16(offset, SUBSYSTEM_WINDOWS_GUI, true);
	try {
		await Bun.write(path, bytes);
		patched++;
	} catch (err) {
		// 起動中のインスタンスがbun.exeを掴んでいると書き込めない。
		// 次回のビルドで適用されるのでビルド自体は失敗させない
		console.warn(`postBuild(patch-win-bun-subsystem): 書き込めませんでした: ${path}: ${String(err)}`);
	}
}

console.log(`postBuild(patch-win-bun-subsystem): ${patched}件のbun.exeをGUI subsystemへ変更`);
