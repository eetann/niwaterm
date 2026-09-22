// Windowsのウィンドウ透過。Electrobunの`transparent: true`はWS_EX_LAYEREDを立てるだけで
// SetLayeredWindowAttributes/UpdateLayeredWindowを呼ばない（CEFのオフスクリーン描画が
// レイヤーを塗る前提のコード）。WebView2は子HWNDとして別に合成されるため中身は見えるが、
// 親ウィンドウ側の描画であるキャプション・枠がDWMに出力されなくなる。
//
// WS_EX_LAYEREDを剥がし、代わりにDwmEnableBlurBehindWindowで
// クライアント領域のper-pixel alphaを有効にすると、ネイティブ枠を保ったまま透過できる。
#include <dwmapi.h>
#include <windows.h>

// 一度の呼び出しで処理する上限。ウィンドウは高々数枚なのでこれで足りる
#define NIWA_MAX_WINDOWS 16

typedef struct {
  DWORD pid;
  HWND hwnds[NIWA_MAX_WINDOWS];
  int count;
} NiwaFindWindowCtx;

// Electrobunがトップレベルウィンドウへ登録するクラス名（package/src/native/win/nativeWrapper.cpp）
static const wchar_t *const kElectrobunWindowClass = L"BasicWindowClass";

// 差し替え前のウィンドウプロシージャの置き場。ウィンドウごとに持つ必要があるためプロパティに載せる
// （静的変数1つだと2枚目のウィンドウで1枚目の分を上書きし、どちらの入力も壊れる）。
// 「このウィンドウは処理済みか」の判定も兼ねる
static const wchar_t *const kPrevWndProcProp = L"NiwatermPrevWndProc";

static LRESULT CALLBACK niwa_transparent_wndproc(HWND hwnd, UINT msg, WPARAM wparam,
                                                 LPARAM lparam) {
  WNDPROC prev = (WNDPROC)GetPropW(hwnd, kPrevWndProcProp);

  // DWMへper-pixel alphaを渡すには、クライアント領域のアルファを実際にゼロで塗る必要がある。
  // Electrobunのウィンドウクラスは背景ブラシを持たない（hbrBackground = NULL）ため
  // 誰もリダイレクションサーフェスを初期化せず、既定の不透明な白が残り続ける。
  // BLACKNESSのPatBltはRGBA全チャンネルを0にするので、これがアルファのクリアになる
  if (msg == WM_ERASEBKGND) {
    HDC hdc = (HDC)wparam;
    RECT rc;
    GetClientRect(hwnd, &rc);
    PatBlt(hdc, rc.left, rc.top, rc.right - rc.left, rc.bottom - rc.top, BLACKNESS);
    return 1;
  }

  if (msg == WM_NCDESTROY) {
    LRESULT result = prev ? CallWindowProcW(prev, hwnd, msg, wparam, lparam)
                          : DefWindowProcW(hwnd, msg, wparam, lparam);
    if (prev) SetWindowLongPtrW(hwnd, GWLP_WNDPROC, (LONG_PTR)prev);
    RemovePropW(hwnd, kPrevWndProcProp);
    return result;
  }

  return prev ? CallWindowProcW(prev, hwnd, msg, wparam, lparam)
              : DefWindowProcW(hwnd, msg, wparam, lparam);
}

static BOOL CALLBACK niwa_find_windows(HWND hwnd, LPARAM lparam) {
  NiwaFindWindowCtx *ctx = (NiwaFindWindowCtx *)lparam;
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  if (pid != ctx->pid) return TRUE;
  if (!IsWindowVisible(hwnd)) return TRUE;
  // 処理済みのウィンドウは飛ばす（ウィンドウを増やすたびに呼ばれるため、
  // 二重にサブクラス化するとプロシージャの鎖が壊れる）
  if (GetPropW(hwnd, kPrevWndProcProp)) return TRUE;

  wchar_t cls[64];
  int len = GetClassNameW(hwnd, cls, (int)(sizeof(cls) / sizeof(cls[0])));
  if (len <= 0 || wcscmp(cls, kElectrobunWindowClass) != 0) return TRUE;

  ctx->hwnds[ctx->count++] = hwnd;
  return ctx->count < NIWA_MAX_WINDOWS;
}

/** 1枚のウィンドウを透過可能にする。戻り値はniwa_win_enable_window_transparencyと同じ */
static int niwa_make_window_transparent(HWND hwnd) {
  LONG_PTR ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
  if (ex & WS_EX_LAYERED) {
    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex & ~(LONG_PTR)WS_EX_LAYERED);
  }

  // 空リージョン（右下が左上より小さい矩形）を渡すのが「ぼかしは不要、
  // per-pixel alphaだけ有効にする」の定型。DWM_BB_BLURREGIONを外してNULLを渡すと
  // ウィンドウ全面がぼかし対象になる
  HRGN empty = CreateRectRgn(0, 0, -1, -1);
  DWM_BLURBEHIND bb;
  ZeroMemory(&bb, sizeof(bb));
  bb.dwFlags = DWM_BB_ENABLE | DWM_BB_BLURREGION;
  bb.fEnable = TRUE;
  bb.hRgnBlur = empty;
  HRESULT hr = DwmEnableBlurBehindWindow(hwnd, &bb);
  DeleteObject(empty);
  if (FAILED(hr)) return -2;

  // 全辺-1のマージンはフレームをクライアント領域全体へ拡張する指定（sheet of glass）。
  // blur-behindだけではリダイレクションサーフェスのアルファがDWMまで届かない
  MARGINS margins = {-1, -1, -1, -1};
  hr = DwmExtendFrameIntoClientArea(hwnd, &margins);
  if (FAILED(hr)) return -3;

  WNDPROC prev =
      (WNDPROC)SetWindowLongPtrW(hwnd, GWLP_WNDPROC, (LONG_PTR)niwa_transparent_wndproc);
  if (!prev) return -4;
  SetPropW(hwnd, kPrevWndProcProp, (HANDLE)prev);

  InvalidateRect(hwnd, NULL, TRUE);

  // 非クライアント領域の再計算を促さないと、WS_EX_LAYEREDを剥がしても枠が描き直されない
  SetWindowPos(hwnd, NULL, 0, 0, 0, 0,
               SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
  return 0;
}

/**
 * 自プロセスのElectrobunウィンドウのうち、まだ処理していないものをすべて、
 * ネイティブ枠を保ったまま透過可能にする。ウィンドウを開くたびに呼ぶ想定。
 * 0=成功, -1=対象ウィンドウ未発見, -2=DWMへの要求が失敗, -4=プロシージャ差し替えが失敗。
 */
int niwa_win_enable_window_transparency(void) {
  NiwaFindWindowCtx ctx = {GetCurrentProcessId(), {0}, 0};
  EnumWindows(niwa_find_windows, (LPARAM)&ctx);
  if (ctx.count == 0) return -1;

  int result = 0;
  for (int i = 0; i < ctx.count; i++) {
    int rc = niwa_make_window_transparent(ctx.hwnds[i]);
    // 1枚でも失敗したら最初の失敗を返す（成功した分はそのまま透過されている）
    if (rc != 0 && result == 0) result = rc;
  }
  return result;
}
