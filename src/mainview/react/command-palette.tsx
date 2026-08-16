import { useMemo } from "react";
import type { KeybindAction } from "@niwaterm/config";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  COMMAND_PALETTE_ACTIONS,
  type CommandPaletteActionDef,
  type CommandPaletteCategory,
} from "../command-palette-actions";

export type NonPaletteKeybindAction = Exclude<KeybindAction, "command-palette">;

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectAction: (action: NonPaletteKeybindAction) => void;
  shortcutLabelFor: (action: NonPaletteKeybindAction) => string | undefined;
}

function groupByCategory(
  defs: readonly CommandPaletteActionDef[],
): Map<CommandPaletteCategory, CommandPaletteActionDef[]> {
  const map = new Map<CommandPaletteCategory, CommandPaletteActionDef[]>();
  for (const def of defs) {
    const list = map.get(def.category) ?? [];
    list.push(def);
    map.set(def.category, list);
  }
  return map;
}

export function CommandPalette({
  open,
  onOpenChange,
  onSelectAction,
  shortcutLabelFor,
}: CommandPaletteProps) {
  const grouped = useMemo(() => groupByCategory(COMMAND_PALETTE_ACTIONS), []);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="コマンドを検索..." />
      <CommandList>
        <CommandEmpty>該当するコマンドがありません</CommandEmpty>
        {[...grouped.entries()].map(([category, defs]) => (
          <CommandGroup key={category} heading={category}>
            {defs.map((def) => {
              const Icon = def.icon;
              const shortcut = shortcutLabelFor(def.action);
              return (
                <CommandItem
                  key={def.action}
                  value={def.labelEn}
                  keywords={def.keywords ? [def.label, ...def.keywords] : [def.label]}
                  onSelect={() => {
                    onOpenChange(false);
                    onSelectAction(def.action);
                  }}
                >
                  <Icon />
                  <div className="flex flex-col">
                    <span>{def.labelEn}</span>
                    <span className="text-xs text-muted-foreground">{def.label}</span>
                  </div>
                  {shortcut && <CommandShortcut>{shortcut}</CommandShortcut>}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
