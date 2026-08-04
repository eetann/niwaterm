/** エラーメッセージを表示し、詳細ドキュメントへの導線を添えて終了コード1で終了する */
export function failAndExit(message: string): never {
  if (message) console.error(message);
  console.error('詳しくは "niwaterm docs show cli" を参照してください。');
  process.exit(1);
}
