// ブラウザタブ（<electrobun-webview>で表示するタブ）の状態。
// PTYと異なりbun側でI/Oを持たず、初期表示に使うurlのみを保持する薄いレコード。

export interface BrowserTabState {
  url: string;
}

export interface BrowserRenderState {
  kind: "browser";
  url: string;
}
