import { type Ref, useEffect, useRef, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** deltaMode=line/page時の1単位あたりの送り量。行はテキスト1行ぶん、ページは表示幅ぶん進める */
const WHEEL_LINE_PX = 16;

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
 * 横スクロールを成立させるには3点必要で、どれか1つでも欠けると動かない:
 * ルートのmin-w-0（無いとタブ列のmin-contentがサイドバー幅を押し広げてしまい、そもそも溢れない）、
 * overflow-x-auto、縦ホイールを横送りへ振り替えるwheelハンドラ（overflow-x:autoだけでは
 * 縦ホイールが横スクロールへ回らず、スクロールバーも隠しているため操作手段が無くなる）。
 * flex-1は残り幅いっぱいまでタブ列を広げるため（TabsListのw-fullはこの幅を基準にする）。
 */
export function SidebarSwitcher({ views, activeViewId, onSelect }: SidebarSwitcherProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const activeTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeTriggerRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeViewId]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // トラックパッドの横入力はそのまま、縦ホイールは横方向へ振り替える
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      // deltaMode: 0=pixel, 1=line, 2=page（DOM_DELTA_*）
      const delta =
        e.deltaMode === 1 ? raw * WHEEL_LINE_PX : e.deltaMode === 2 ? raw * el.clientWidth : raw;
      const before = el.scrollLeft;
      el.scrollLeft = before + delta;
      // 端まで来たら既定動作へ返す（実際に動かせたときだけイベントを奪う）
      if (el.scrollLeft !== before) e.preventDefault();
    };
    // ReactのonWheelはpassiveで登録されpreventDefaultできないため、自前でaddEventListenerする
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <Tabs className="min-w-0 flex-1" value={activeViewId} onValueChange={onSelect}>
      <TabsList
        ref={listRef}
        variant="line"
        className="h-auto w-full justify-start overflow-x-auto rounded-none p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {views.map((view) => (
          <ViewTabTrigger
            key={view.id}
            view={view}
            triggerRef={view.id === activeViewId ? activeTriggerRef : undefined}
          />
        ))}
      </TabsList>
    </Tabs>
  );
}

/** ビュー名が省略表示（truncate）されているときだけ、全文をツールチップで出す */
function ViewTabTrigger({
  view,
  triggerRef,
}: {
  view: SidebarSwitcherView;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const labelRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        const labelEl = labelRef.current;
        setOpen(next && !!labelEl && labelEl.scrollWidth > labelEl.clientWidth);
      }}
    >
      <TooltipTrigger asChild>
        <TabsTrigger
          ref={triggerRef}
          value={view.id}
          className="h-8 min-w-20 flex-1 shrink-0 px-2 text-xs font-bold"
        >
          <span ref={labelRef} className="truncate">
            {view.name}
          </span>
        </TabsTrigger>
      </TooltipTrigger>
      <TooltipContent>{view.name}</TooltipContent>
    </Tooltip>
  );
}
