// Electrobunのpreloadが提供するドラッグ領域のクラス名（api/preload/dragRegions.ts）。
// preloadはmousedownの発生元からDOMツリーを遡り、このクラスが見つかればネイティブの
// ウィンドウ移動を開始する。`-webkit-app-region`をCSSへ書く経路もあるが、宣言を落とす
// エンジン向けにpreloadがスタイルシートを読み直して補う作りのため、クラス指定のほうが確実。
export const DRAG_REGION_CLASS = "electrobun-webkit-app-region-drag";
/** ドラッグ領域の中でクリック操作を通したい要素（ボタン等）へ付ける */
export const NO_DRAG_REGION_CLASS = "electrobun-webkit-app-region-no-drag";
