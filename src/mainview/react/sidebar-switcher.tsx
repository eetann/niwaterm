import { useEffect, useRef } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface SidebarSwitcherView {
  id: string;
  name: string;
}

export interface SidebarSwitcherProps {
  /** 先頭がワークスペース一覧、続いて設定順のcustomView */
  views: SidebarSwitcherView[];
  activeViewId: string;
  onSelect: (viewId: string) => void;
}

/**
 * #sidebar-switcher自体のhidden属性切り替えはこのコンポーネントの責務にしない
 * （マウント先コンテナ自身の属性はReactツリーの外側であり、applyCustomViews()側で維持する）。
 * ビューが増えるとサイドバーの幅（既定200px）には収まらなくなるため、タブ列は横スクロールさせる。
 * スクロールバー自体は隠し、代わりにキーバインド・CLIで切り替えたときは選択中のタブを見える位置へ送る
 * （切り替え先が画面外のままだと、今どのビューを出しているのか分からなくなるため）。
 */
export function SidebarSwitcher({ views, activeViewId, onSelect }: SidebarSwitcherProps) {
  const activeTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeTriggerRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeViewId]);

  return (
    <Tabs value={activeViewId} onValueChange={onSelect}>
      <TabsList
        variant="line"
        className="h-auto w-full justify-start overflow-x-auto rounded-none p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {views.map((view) => (
          <TabsTrigger
            key={view.id}
            ref={view.id === activeViewId ? activeTriggerRef : undefined}
            value={view.id}
            className="h-8 min-w-20 flex-1 shrink-0 px-2 text-xs font-bold"
            title={view.name}
          >
            <span className="truncate">{view.name}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
