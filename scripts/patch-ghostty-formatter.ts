// libghostty-vtのフォーマッタ（画面のHTML/VTダンプ）へniwaterm用のパッチを当てる。
// 第1引数にghosttyのソースディレクトリを取る（省略時は vendor/libghostty）。
//
// 素のフォーマッタは、背景色を設定したままカーソルを右へ飛ばす出力（CHA・CUFなど）で
// 飛び越えられた空セルを、HTML出力では直前のセルのスタイルを開いたまま空白として書き出す。
// niwatermはこのHTMLをそのまま描画するため、何も書かれていないセルが直前の背景色で
// 塗られて見える。Claude Codeの起動バナーが典型例で、ロゴとテキストの間が黒く残る。
// VT出力は上流が空セルをCUFで飛ばす（行をまたぐ分はスタイルを閉じる）ため、HTML出力だけに当てる。
// 詳細: docs/known-issues/libghostty-vt-formatter-bleeds-bg-into-skipped-cells.md
//
// vendor/libghostty はgitignore対象でリポジトリへ含められないため、パッチは差分ファイルでは
// なくこのスクリプトで持ち、vendorのビルドのたびに当て直す。
import { existsSync } from "node:fs";
import { join } from "node:path";

const srcDir = process.argv[2] ?? join(import.meta.dir, "..", "vendor", "libghostty");
const TARGET = join(srcDir, "src", "terminal", "formatter.zig");

/** [適用前, 適用後] の組。適用後の文字列が既にあれば適用済みとみなす */
const REPLACEMENTS: [string, string][] = [
  [
    `                    if (comptime formatStyled(emit)) {
                        if (style_id == invalid_style_id) break :fast;
                    }`,
    `                    if (comptime formatStyled(emit)) {
                        if (style_id == invalid_style_id) break :fast;
                    }

                    // Accumulated blanks come from unstyled empty cells.
                    // The fast path writes them as spaces under the
                    // currently open style, so fall back to the slow path
                    // which closes the style first.
                    if (comptime emit == .html) {
                        if (blank_cells > 0 and !style.default()) break :fast;
                    }`,
  ],
  [
    `                if (blank_cells > 0) {
                    // Blank cells have no hyperlink.`,
    `                if (blank_cells > 0) {
                    // Reset style before emitting the blanks to prevent
                    // background colors from bleeding into unstyled empty
                    // cells, e.g. cells a cursor move jumped over while a
                    // background color was set.
                    if (comptime emit == .html) {
                        if (!style.default()) {
                            try self.formatStyleClose(emit, writer);
                            style = .{};
                            style_id = 0;
                        }
                    }

                    // Blank cells have no hyperlink.`,
  ],
];

if (!existsSync(TARGET)) {
  console.error(`patch-ghostty-formatter: 見つかりません: ${TARGET}`);
  process.exit(1);
}

let source = await Bun.file(TARGET).text();
let applied = 0;

for (const [before, after] of REPLACEMENTS) {
  if (source.includes(after)) continue;

  // 想定の箇所が無い＝ghostty側でフォーマッタの実装が変わった可能性がある。黙って素通りさせると
  // 背景色のにじみが戻ったことに気づけないので、ここで止める
  if (!source.includes(before)) {
    console.error(
      `patch-ghostty-formatter: 想定の箇所が見つかりません。ghosttyの更新で\n` +
        `フォーマッタの実装が変わった可能性があります。${TARGET} を確認し、\n` +
        `まだ同じ問題が残っているならこのスクリプトを直してください。\n` +
        `  探した箇所:\n${before}`,
    );
    process.exit(1);
  }

  source = source.replace(before, after);
  applied++;
}

if (applied === 0) {
  console.log("patch-ghostty-formatter: 適用済み");
  process.exit(0);
}

await Bun.write(TARGET, source);
console.log(`patch-ghostty-formatter: 適用しました (${applied}箇所): ${TARGET}`);
