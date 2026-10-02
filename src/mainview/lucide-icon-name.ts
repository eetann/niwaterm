/**
 * lucideのアイコン名（kebab-case、https://lucide.dev/icons/ に載っている形）を、lucide-reactの
 * `icons`のキー（PascalCase）へ変換する。数字の前のハイフンも詰める（`arrow-down-0-1` → `ArrowDown01`）
 */
export function lucideIconKey(name: string): string {
  return name
    .trim()
    .split("-")
    .filter((part) => part !== "")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}
