import type { WebviewTagElement } from "electrobun/view";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { extractNavigatedUrl } from "../navigated-url";
import { normalizeUrl } from "../normalize-url";

export interface BrowserToolbarProps {
  webviewEl: WebviewTagElement;
  initialUrl: string;
  /**
   * マウント直後にURL欄をフォーカスし全選択する。URLを打ってEnterするだけで遷移できる状態で
   * タブを開くために使う（全選択なので既定URLが入っていても上書き入力になり、Escで元へ戻せる）
   */
  autoFocusUrl?: boolean;
  onRequestTerminalFocus: () => void;
}

/**
 * index.ts側からは初回のみroot.render()される（他の領域と異なり、以後はコンポーネント自身が
 * webviewEl自身のdid-navigateイベント等を購読して内部stateで完結する。クライアントローカルな
 * 一過性の状態であり、bunからpushされる状態のミラーではないため）。
 */
export function BrowserToolbar({
  webviewEl,
  initialUrl,
  autoFocusUrl,
  onRequestTerminalFocus,
}: BrowserToolbarProps) {
  const [url, setUrl] = useState(initialUrl);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  // Escで編集を取り消す際に戻す先。did-navigateのたびに最新のURLへ更新する
  const lastKnownUrlRef = useRef(initialUrl);
  const inputRef = useRef<HTMLInputElement>(null);

  // autoFocusUrlはタブ生成時のrenderで固定される（このrootへ同じコンポーネントが再renderされない）
  // ため、実質マウント時の一度だけ走る
  useEffect(() => {
    if (!autoFocusUrl) return;
    const inputEl = inputRef.current;
    if (!inputEl) return;
    inputEl.focus({ preventScroll: true });
    inputEl.select();
  }, [autoFocusUrl]);

  useEffect(() => {
    const updateNavButtons = () => {
      void webviewEl.canGoBack().then(setCanGoBack);
      void webviewEl.canGoForward().then(setCanGoForward);
    };
    const onDidNavigate = (e: CustomEvent) => {
      const newUrl = extractNavigatedUrl(e.detail);
      if (newUrl) {
        lastKnownUrlRef.current = newUrl;
        if (document.activeElement !== inputRef.current) setUrl(newUrl);
      }
      updateNavButtons();
    };
    webviewEl.on("did-navigate", onDidNavigate);
    return () => webviewEl.off("did-navigate", onDidNavigate);
  }, [webviewEl]);

  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={!canGoBack}
        title="戻る"
        onClick={() => webviewEl.goBack()}
      >
        ←
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={!canGoForward}
        title="進む"
        onClick={() => webviewEl.goForward()}
      >
        →
      </Button>
      <Button variant="ghost" size="icon-xs" title="再読み込み" onClick={() => webviewEl.reload()}>
        ⟳
      </Button>
      <Input
        ref={inputRef}
        type="text"
        spellCheck={false}
        autoComplete="off"
        className="h-7 flex-1 text-xs"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            webviewEl.loadURL(normalizeUrl(url));
            onRequestTerminalFocus();
          } else if (e.key === "Escape") {
            setUrl(lastKnownUrlRef.current);
            onRequestTerminalFocus();
          }
        }}
      />
    </>
  );
}
