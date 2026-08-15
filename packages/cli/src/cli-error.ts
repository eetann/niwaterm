/** エラーメッセージを表示して終了コード1で終了する */
export function failAndExit(message: string): never {
  if (message) console.error(message);
  process.exit(1);
}
