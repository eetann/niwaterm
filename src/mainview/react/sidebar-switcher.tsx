import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface SidebarSwitcherProps {
  customViewName: string;
  showingCustom: boolean;
  onShowList: () => void;
  onShowCustom: () => void;
}

/**
 * #sidebar-switcher自体のhidden属性切り替えはこのコンポーネントの責務にしない
 * （マウント先コンテナ自身の属性はReactツリーの外側であり、applyCustomView()側で維持する）。
 */
export function SidebarSwitcher({
  customViewName,
  showingCustom,
  onShowList,
  onShowCustom,
}: SidebarSwitcherProps) {
  return (
    <Tabs
      value={showingCustom ? "custom" : "list"}
      onValueChange={(v) => (v === "custom" ? onShowCustom() : onShowList())}
    >
      <TabsList variant="line" className="h-auto w-full rounded-none p-0">
        <TabsTrigger value="list" className="h-8 flex-1 text-xs font-bold">
          Workspaces
        </TabsTrigger>
        <TabsTrigger value="custom" className="h-8 flex-1 text-xs font-bold">
          {customViewName}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
