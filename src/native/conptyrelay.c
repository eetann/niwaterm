// Windows専用: 同梱した新しいConPTY（conpty.dll＋OpenConsole.exe）でシェルを起動し、
// 入出力をniwatermとの標準入出力へ中継する（ADR 0009）。
//
// OS標準のConPTYは子の出力をconhostで描き直してから流すため、OSCの位置ずれやAPCの欠落が起きる。
// 新しいConPTYはVTをそのまま流すが、Bun.Terminalはkernel32のCreatePseudoConsoleしか呼べない。
// conpty.dllをniwatermのプロセスへ直接読み込まないのは、出力を読むネイティブのスレッドから
// JSへのコールバックが、Bun Worker内では発火しないことがあるため。
//
// 使い方: niwaterm-conpty.exe <cols> <rows> -- <command> [args...]
// stdout: シェルの出力をそのまま流す
// stdin:  [種類 1バイト][長さ u32 LE][中身] の繰り返し。種類0=入力、1=リサイズ（cols u16 LE, rows u16 LE）
// 終了コード: シェルの終了コード

#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include <windows.h>

#define FRAME_INPUT 0
#define FRAME_RESIZE 1
// 入力1回ぶんの上限。貼り付けでも数MBに収まるため、壊れた長さで巨大な確保をしないための上限
#define MAX_FRAME_LEN (16u * 1024u * 1024u)
// CreateProcessWのコマンドラインの上限（終端を含む）
#define MAX_CMDLINE 32768

typedef HRESULT(WINAPI *CreateFn)(COORD, HANDLE, HANDLE, DWORD, HPCON *);
typedef HRESULT(WINAPI *ResizeFn)(HPCON, COORD);
typedef VOID(WINAPI *CloseFn)(HPCON);

static HANDLE conpty_in;   // ConPTYへの入力（書き込み側）
static HANDLE conpty_out;  // ConPTYからの出力（読み込み側）
static HPCON pc;
static ResizeFn resize_pc;

static void fail(const char *msg) {
  DWORD w;
  HANDLE err = GetStdHandle(STD_ERROR_HANDLE);
  if (err && err != INVALID_HANDLE_VALUE) {
    WriteFile(err, msg, (DWORD)strlen(msg), &w, NULL);
    WriteFile(err, "\n", 1, &w, NULL);
  }
  ExitProcess(127);
}

static BOOL write_all(HANDLE h, const char *buf, DWORD len) {
  while (len > 0) {
    DWORD w;
    if (!WriteFile(h, buf, len, &w, NULL)) return FALSE;
    buf += w;
    len -= w;
  }
  return TRUE;
}

static BOOL read_exact(HANDLE h, char *buf, DWORD len) {
  while (len > 0) {
    DWORD n;
    if (!ReadFile(h, buf, len, &n, NULL) || n == 0) return FALSE;
    buf += n;
    len -= n;
  }
  return TRUE;
}

static DWORD WINAPI pump_output(LPVOID arg) {
  (void)arg;
  HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
  char buf[65536];
  DWORD n;
  while (ReadFile(conpty_out, buf, sizeof(buf), &n, NULL) && n > 0) {
    if (!write_all(out, buf, n)) break;
  }
  return 0;
}

// stdinが閉じたら（niwaterm側がPTYを閉じた）戻る
static DWORD WINAPI pump_input(LPVOID arg) {
  (void)arg;
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  for (;;) {
    unsigned char header[5];
    if (!read_exact(in, (char *)header, sizeof(header))) return 0;
    uint32_t len = (uint32_t)header[1] | ((uint32_t)header[2] << 8) | ((uint32_t)header[3] << 16) |
                   ((uint32_t)header[4] << 24);
    if (len > MAX_FRAME_LEN) return 0;
    char *payload = len > 0 ? malloc(len) : NULL;
    if (len > 0 && (!payload || !read_exact(in, payload, len))) {
      free(payload);
      return 0;
    }
    if (header[0] == FRAME_INPUT) {
      write_all(conpty_in, payload, len);
    } else if (header[0] == FRAME_RESIZE && len >= 4) {
      unsigned char *p = (unsigned char *)payload;
      COORD size = {(SHORT)(p[0] | (p[1] << 8)), (SHORT)(p[2] | (p[3] << 8))};
      resize_pc(pc, size);
    }
    free(payload);
  }
}

// 引数をCreateProcessWのコマンドライン1つへ連結する。CommandLineToArgvW（MSVCランタイム）の
// 規則で元の引数へ戻るようクォートする。空白・タブ・改行・"を含む引数だけをクォートし、
// "の直前と末尾のバックスラッシュは倍にする
static BOOL append_arg(wchar_t *buf, size_t *len, const wchar_t *arg) {
  size_t pos = *len;
#define PUT(ch)                                    \
  do {                                             \
    if (pos + 1 >= MAX_CMDLINE) return FALSE;      \
    buf[pos++] = (ch);                             \
  } while (0)
  if (pos > 0) PUT(L' ');
  if (arg[0] != L'\0' && wcspbrk(arg, L" \t\n\v\"") == NULL) {
    for (const wchar_t *c = arg; *c; c++) PUT(*c);
  } else {
    PUT(L'"');
    for (const wchar_t *c = arg;; c++) {
      size_t backslashes = 0;
      while (*c == L'\\') {
        backslashes++;
        c++;
      }
      if (*c == L'\0') {
        for (size_t i = 0; i < backslashes * 2; i++) PUT(L'\\');
        break;
      }
      if (*c == L'"') {
        for (size_t i = 0; i < backslashes * 2 + 1; i++) PUT(L'\\');
      } else {
        for (size_t i = 0; i < backslashes; i++) PUT(L'\\');
      }
      PUT(*c);
    }
    PUT(L'"');
  }
#undef PUT
  buf[pos] = L'\0';
  *len = pos;
  return TRUE;
}

// 自分と同じフォルダのconpty.dllを読む。OpenConsole.exeはconpty.dllが自分の隣から探す
static HMODULE load_conpty(void) {
  wchar_t path[MAX_PATH];
  DWORD n = GetModuleFileNameW(NULL, path, MAX_PATH);
  if (n == 0 || n >= MAX_PATH) return NULL;
  wchar_t *slash = wcsrchr(path, L'\\');
  if (!slash || (size_t)(slash - path) + 12 >= MAX_PATH) return NULL;
  wcscpy(slash + 1, L"conpty.dll");
  return LoadLibraryW(path);
}

int wmain(int argc, wchar_t **argv) {
  if (argc < 5 || wcscmp(argv[3], L"--") != 0) fail("usage: niwaterm-conpty <cols> <rows> -- <command>...");
  COORD size = {(SHORT)_wtoi(argv[1]), (SHORT)_wtoi(argv[2])};
  if (size.X <= 0 || size.Y <= 0) fail("invalid size");

  // 中継exeがどう終わっても（niwatermからの強制終了を含む）シェルとOpenConsole.exeを残さない。
  // 自分ごとJobに入れておくと、以降に起動する子も同じJobに入り、最後のハンドル＝自分の終了で全員終わる
  HANDLE job = CreateJobObjectW(NULL, NULL);
  if (job) {
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limit;
    ZeroMemory(&limit, sizeof(limit));
    limit.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limit, sizeof(limit));
    AssignProcessToJobObject(job, GetCurrentProcess());
  }

  HMODULE conpty = load_conpty();
  if (!conpty) fail("failed to load conpty.dll");
  CreateFn create_pc = (CreateFn)GetProcAddress(conpty, "ConptyCreatePseudoConsole");
  resize_pc = (ResizeFn)GetProcAddress(conpty, "ConptyResizePseudoConsole");
  CloseFn close_pc = (CloseFn)GetProcAddress(conpty, "ConptyClosePseudoConsole");
  if (!create_pc || !resize_pc || !close_pc) fail("conpty.dll lacks expected exports");

  HANDLE in_read, out_write;
  if (!CreatePipe(&in_read, &conpty_in, NULL, 0) || !CreatePipe(&conpty_out, &out_write, NULL, 0)) {
    fail("CreatePipe failed");
  }
  if (FAILED(create_pc(size, in_read, out_write, 0, &pc))) fail("ConptyCreatePseudoConsole failed");
  // ConPTY側へ渡したハンドルは閉じる。残すと子が終わっても出力パイプのEOFが来ない
  CloseHandle(in_read);
  CloseHandle(out_write);

  static wchar_t cmdline[MAX_CMDLINE];
  size_t cmdlen = 0;
  cmdline[0] = L'\0';
  for (int i = 4; i < argc; i++) {
    if (!append_arg(cmdline, &cmdlen, argv[i])) fail("command line too long");
  }

  STARTUPINFOEXW si;
  ZeroMemory(&si, sizeof(si));
  si.StartupInfo.cb = sizeof(si);
  // 標準ハンドルを継承させない。継承すると子は疑似コンソールではなくniwatermとのパイプへ直接書く
  si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  SIZE_T attr_size = 0;
  InitializeProcThreadAttributeList(NULL, 1, 0, &attr_size);
  si.lpAttributeList = (LPPROC_THREAD_ATTRIBUTE_LIST)HeapAlloc(GetProcessHeap(), 0, attr_size);
  if (!si.lpAttributeList || !InitializeProcThreadAttributeList(si.lpAttributeList, 1, 0, &attr_size) ||
      !UpdateProcThreadAttribute(si.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, pc, sizeof(pc),
                                 NULL, NULL)) {
    fail("failed to set up the pseudo console attribute");
  }

  // cwd・環境変数は中継exe自身のもの（niwatermのBun.spawnが渡したもの）をそのまま引き継ぐ
  PROCESS_INFORMATION child;
  if (!CreateProcessW(NULL, cmdline, NULL, NULL, FALSE, EXTENDED_STARTUPINFO_PRESENT, NULL, NULL,
                      &si.StartupInfo, &child)) {
    fail("CreateProcessW failed");
  }
  CloseHandle(child.hThread);

  HANDLE output_thread = CreateThread(NULL, 0, pump_output, NULL, 0, NULL);
  HANDLE input_thread = CreateThread(NULL, 0, pump_input, NULL, 0, NULL);
  if (!output_thread || !input_thread) fail("CreateThread failed");

  HANDLE waits[2] = {child.hProcess, input_thread};
  if (WaitForMultipleObjects(2, waits, FALSE, INFINITE) == WAIT_OBJECT_0 + 1) {
    // niwaterm側がPTYを閉じた
    TerminateProcess(child.hProcess, 1);
    WaitForSingleObject(child.hProcess, INFINITE);
  }
  DWORD code = 1;
  GetExitCodeProcess(child.hProcess, &code);

  // 疑似コンソールを閉じると、OpenConsole.exeが残りの出力を流しきってから出力パイプが閉じる。
  // 子の終了直後に出た最後の出力を取りこぼさないよう、出力スレッドが流しきるのを待ってから終わる
  close_pc(pc);
  WaitForSingleObject(output_thread, 3000);
  ExitProcess(code);
}
