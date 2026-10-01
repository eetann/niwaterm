import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DomTooltipState } from "../dom-tooltip";

/**
 * 素DOM側の共有ツールチップ（../dom-tooltip.ts）の表示。見た目をReact側のTooltipと揃えるため、
 * ホバー中の要素に重ねた透明な箱をTooltipTriggerにして、位置決め（はみ出し時の反転含む）をRadixに任せる。
 * 幅の上限は必ず付ける。Radixの位置決め用ラッパーがmin-width: max-contentを持つため、
 * 上限が無いと長い本文（プロンプト目次など）が折り返されずに横へ伸び続ける
 */
export function DomTooltip({ open, rect, text }: DomTooltipState) {
  if (!rect) return null;
  return (
    <Tooltip open={open}>
      <TooltipTrigger asChild>
        <div
          aria-hidden="true"
          className="pointer-events-none fixed"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
      </TooltipTrigger>
      <TooltipContent className="pointer-events-none max-w-[min(24rem,var(--radix-tooltip-content-available-width))] break-words whitespace-pre-line">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
