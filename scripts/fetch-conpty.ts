// Windowsで使う新しいConPTY（conpty.dll＋OpenConsole.exe）をNuGetから取得し、
// vendor/libghostty/bin/へ置く（ADR 0009）。
// 引数: <版> <nupkgのSHA-256>（mise.tomlの[vars]から渡される）。
//
// OS標準のConPTYは子の出力を描き直すため、Windows Terminalが同梱するのと同じ新しいConPTYを使う。
// 置き先をbin/にしているのは、win:syncがbin/をWindows側へ同期し、中継exe（niwaterm-conpty.exe）と
// 同じフォルダに並ぶため（conpty.dllはOpenConsole.exeを自分の隣から探す）。
//
// WSLにもmacOSにもunzipがあるとは限らないため、ZIPの展開は自前で行う（必要な2ファイルだけ取り出す）。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

const [version, expectedSha256] = process.argv.slice(2);
if (!version || !expectedSha256) {
  console.error("usage: bun scripts/fetch-conpty.ts <version> <sha256>");
  process.exit(1);
}

const destDir = join(import.meta.dir, "..", "vendor", "libghostty", "bin");
const stampPath = join(destDir, "conpty.version");
const ENTRIES: Record<string, string> = {
  "runtimes/win-x64/native/conpty.dll": "conpty.dll",
  "build/native/runtimes/x64/OpenConsole.exe": "OpenConsole.exe",
};

const alreadyFetched =
  existsSync(stampPath) &&
  readFileSync(stampPath, "utf8").trim() === version &&
  Object.values(ENTRIES).every((name) => existsSync(join(destDir, name)));
if (alreadyFetched) process.exit(0);

const url = `https://api.nuget.org/v3-flatcontainer/microsoft.windows.console.conpty/${version}/microsoft.windows.console.conpty.${version}.nupkg`;
const res = await fetch(url);
if (!res.ok) {
  console.error(`ConPTYのパッケージを取得できませんでした: ${res.status} ${url}`);
  process.exit(1);
}
const zip = Buffer.from(await res.arrayBuffer());
const actualSha256 = createHash("sha256").update(zip).digest("hex");
if (actualSha256 !== expectedSha256) {
  console.error(
    `ConPTYのパッケージのSHA-256が一致しません（期待: ${expectedSha256}、実際: ${actualSha256}）`,
  );
  process.exit(1);
}

/** ZIPの中央ディレクトリを引いて、名前→中身の対応を返す（ENTRIESに載っているものだけ） */
function extract(buf: Buffer): Map<string, Buffer> {
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIPの終端レコードが見つかりません");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    // NuGetはパス中の一部の記号をパーセントエンコードして格納する
    const name = decodeURIComponent(buf.toString("utf8", p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!(name in ENTRIES)) continue;
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const data = buf.subarray(start, start + compressedSize);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data));
    else throw new Error(`未対応の圧縮方式です: ${method} (${name})`);
  }
  return out;
}

const files = extract(zip);
mkdirSync(destDir, { recursive: true });
for (const [entry, name] of Object.entries(ENTRIES)) {
  const data = files.get(entry);
  if (!data) {
    console.error(`パッケージに${entry}がありません`);
    process.exit(1);
  }
  writeFileSync(join(destDir, name), data);
}
writeFileSync(stampPath, `${version}\n`);
console.log(`ConPTY ${version} を ${destDir} へ配置しました`);
