// Windowsのウィンドウ透過。Electrobunの`transparent: true`はWS_EX_LAYEREDを立てるだけで
// SetLayeredWindowAttributes/UpdateLayeredWindowを呼ばない（CEFのオフスクリーン描画が
// レイヤーを塗る前提のコード）。WebView2は子HWNDとして別に合成されるため中身は見えるが、
// 親ウィンドウ側の描画であるキャプション・枠がDWMに出力されなくなる。
//
// WS_EX_LAYEREDを剥がし、代わりにDwmEnableBlurBehindWindowで
// クライアント領域のper-pixel alphaを有効にすると、ネイティブ枠を保ったまま透過できる。
#include <dwmapi.h>
#include <windows.h>

typedef struct {
  DWORD pid;
  HWND hwnd;
} NiwaFindWindowCtx;

// Electrobunがトップレベルウィンドウへ登録するクラス名（package/src/native/win/nativeWrapper.cpp）
static const wchar_t *const kElectrobunWindowClass = L"BasicWindowClass";

static BOOL CALLBACK niwa_find_main_window(HWND hwnd, LPARAM lparam) {
  NiwaFindWindowCtx *ctx = (NiwaFindWindowCtx *)lparam;
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  if (pid != ctx->pid) return TRUE;
  if (!IsWindowVisible(hwnd)) return TRUE;

  wchar_t cls[64];
  int len = GetClassNameW(hwnd, cls, (int)(sizeof(cls) / sizeof(cls[0])));
  if (len <= 0 || wcscmp(cls, kElectrobunWindowClass) != 0) return TRUE;

  ctx->hwnd = hwnd;
  return FALSE;
}

static WNDPROC g_prev_wndproc = NULL;

// DWMへper-pixel alphaを渡すには、クライアント領域のアルファを実際にゼロで塗る必要がある。
// Electrobunのウィンドウクラスは背景ブラシを持たない（hbrBackground = NULL）ため
// 誰もリダイレクションサーフェスを初期化せず、既定の不透明な白が残り続ける。
// BLACKNESSのPatBltはRGBA全チャンネルを0にするので、これがアルファのクリアになる
static LRESULT CALLBACK niwa_transparent_wndproc(HWND hwnd, UINT msg, WPARAM wparam,
                                                 LPARAM lparam) {
  if (msg == WM_ERASEBKGND) {
    HDC hdc = (HDC)wparam;
    RECT rc;
    GetClientRect(hwnd, &rc);
    PatBlt(hdc, rc.left, rc.top, rc.right - rc.left, rc.bottom - rc.top, BLACKNESS);
    return 1;
  }
  return CallWindowProcW(g_prev_wndproc, hwnd, msg, wparam, lparam);
}

/**
 * 自プロセスのElectrobunメインウィンドウを、ネイティブ枠を保ったまま透過可能にする。
 * 0=成功, -1=ウィンドウ未発見, -2=DWMへの要求が失敗。
 */
int niwa_win_enable_window_transparency(void) {
  NiwaFindWindowCtx ctx = {GetCurrentProcessId(), NULL};
  EnumWindows(niwa_find_main_window, (LPARAM)&ctx);
  if (!ctx.hwnd) return -1;

  LONG_PTR ex = GetWindowLongPtrW(ctx.hwnd, GWL_EXSTYLE);
  if (ex & WS_EX_LAYERED) {
    SetWindowLongPtrW(ctx.hwnd, GWL_EXSTYLE, ex & ~(LONG_PTR)WS_EX_LAYERED);
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
  HRESULT hr = DwmEnableBlurBehindWindow(ctx.hwnd, &bb);
  DeleteObject(empty);
  if (FAILED(hr)) return -2;

  // 全辺-1のマージンはフレームをクライアント領域全体へ拡張する指定（sheet of glass）。
  // blur-behindだけではリダイレクションサーフェスのアルファがDWMまで届かない
  MARGINS margins = {-1, -1, -1, -1};
  hr = DwmExtendFrameIntoClientArea(ctx.hwnd, &margins);
  if (FAILED(hr)) return -3;

  if (!g_prev_wndproc) {
    g_prev_wndproc =
        (WNDPROC)SetWindowLongPtrW(ctx.hwnd, GWLP_WNDPROC, (LONG_PTR)niwa_transparent_wndproc);
    if (!g_prev_wndproc) return -4;
  }
  InvalidateRect(ctx.hwnd, NULL, TRUE);

  // 非クライアント領域の再計算を促さないと、WS_EX_LAYEREDを剥がしても枠が描き直されない
  SetWindowPos(ctx.hwnd, NULL, 0, 0, 0, 0,
               SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
  return 0;
}
