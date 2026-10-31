#include "native.hpp"
std::mutex labelLock;
std::wstring stopLabel = L"Stop";
std::wstring controlledApplicationName;
std::atomic<DWORD> controlledPid{0};
std::atomic<bool> foregroundControl{false}, quit{false};
std::atomic<unsigned> epoch{0};
HWND panel = nullptr;
std::atomic<HWND> controlledWindow{nullptr};
static Clock::time_point panelStartedAt;
static DWORD panelApplicationPid = 0;
static HFONT panelFont = nullptr;
static HFONT panelTimerFont = nullptr;
static int panelPixels(HWND window, int value) { return MulDiv(value, GetDpiForWindow(window), 96); }
static void layoutPanel(HWND window) {
  RECT area{}; GetClientRect(window, &area);
  SetWindowRgn(window, CreateRoundRectRgn(0, 0, area.right + 1, area.bottom + 1, area.bottom, area.bottom), TRUE);
  MoveWindow(GetDlgItem(window, 1), panelPixels(window, 304), panelPixels(window, 4), panelPixels(window, 82), panelPixels(window, 30), TRUE);
  if (panelFont) DeleteObject(panelFont);
  if (panelTimerFont) DeleteObject(panelTimerFont);
  panelFont = CreateFontW(-panelPixels(window, 13), 0, 0, 0, FW_MEDIUM, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
  panelTimerFont = CreateFontW(-panelPixels(window, 12), 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, FIXED_PITCH, L"Consolas");
}
static void inputDiagnostic(wchar_t const* kind, WPARAM message, ULONG_PTR extra, DWORD flags) {
  wchar_t enabled[2]{}; if (!GetEnvironmentVariableW(L"ARTEMIS_COMPUTER_DIAGNOSTICS", enabled, 2)) return;
  JsonObject event; put(event,L"event",std::wstring(L"input-diagnostic")); put(event,L"kind",std::wstring(kind));
  put(event,L"message",static_cast<double>(message)); put(event,L"extra",std::to_wstring(extra)); put(event,L"flags",static_cast<double>(flags));
  put(event,L"own",extra==injected); put(event,L"controlled",controlledPid.load()!=0); put(event,L"foreground",foregroundControl.load()); emit(event);
}
void paused(wchar_t const* reason) {
  if (!controlledPid.exchange(0)) return;
  foregroundControl = false; controlledWindow = nullptr; epoch++;
  PostMessageW(panel, panelHide, 0, 0);
  JsonObject event; put(event, L"event", std::wstring(L"takeover")); put(event, L"reason", std::wstring(reason)); emit(event);
}
LRESULT CALLBACK keyboardHook(int code, WPARAM key, LPARAM data) {
  if (code >= 0 && (key == WM_KEYDOWN || key == WM_SYSKEYDOWN)) {
    auto input = reinterpret_cast<KBDLLHOOKSTRUCT*>(data);
    inputDiagnostic(L"keyboard",key,input->dwExtraInfo,input->flags);
    if (input->dwExtraInfo != injected && controlledPid && (foregroundControl || isControlledWindow(GetForegroundWindow())))
      paused(L"User input detected");
  }
  return CallNextHookEx(nullptr, code, key, data);
}
LRESULT CALLBACK mouseHook(int code, WPARAM key, LPARAM data) {
  if (code >= 0 && (key == WM_LBUTTONDOWN || key == WM_RBUTTONDOWN || key == WM_MBUTTONDOWN || key == WM_MOUSEWHEEL || key == WM_MOUSEHWHEEL || (foregroundControl && key == WM_MOUSEMOVE))) {
    auto input = reinterpret_cast<MSLLHOOKSTRUCT*>(data);
    inputDiagnostic(L"mouse",key,input->dwExtraInfo,input->flags);
    if (input->dwExtraInfo != injected && key == WM_LBUTTONDOWN && GetAncestor(WindowFromPoint(input->pt),GA_ROOT) == panel) { paused(L"Native Stop button pressed"); return CallNextHookEx(nullptr,code,key,data); }
    if (input->dwExtraInfo != injected && controlledPid && (foregroundControl || isControlledWindow(WindowFromPoint(input->pt))))
      paused(L"User input detected");
  }
  return CallNextHookEx(nullptr, code, key, data);
}
LRESULT CALLBACK panelProc(HWND window, UINT message, WPARAM w, LPARAM l) {
  if (message == panelShow) {
    if (!IsWindowVisible(window) || panelApplicationPid != controlledPid.load()) {
      panelStartedAt = Clock::now(); panelApplicationPid = controlledPid.load();
    }
    std::wstring label;
    { std::lock_guard lock(labelLock); label = stopLabel; }
    SetWindowTextW(GetDlgItem(window, 1), label.c_str());
    InvalidateRect(window, nullptr, FALSE);
    ShowWindow(window, SW_SHOWNOACTIVATE); return 0;
  }
  if (message == panelHide) { ShowWindow(window, SW_HIDE); return 0; }
  if (message == WM_SIZE) { layoutPanel(window); return 0; }
  if (message == WM_DPICHANGED) {
    auto bounds = reinterpret_cast<RECT*>(l);
    SetWindowPos(window, nullptr, bounds->left, bounds->top, bounds->right - bounds->left, bounds->bottom - bounds->top, SWP_NOZORDER | SWP_NOACTIVATE);
    layoutPanel(window); return 0;
  }
  if (message == WM_ERASEBKGND) return 1;
  if (message == WM_PAINT) {
    PAINTSTRUCT paint{}; auto dc = BeginPaint(window, &paint);
    RECT area{}; GetClientRect(window, &area);
    auto background = CreateSolidBrush(RGB(22, 23, 27)); FillRect(dc, &area, background); DeleteObject(background);
    SetBkMode(dc, TRANSPARENT);
    auto oldFont = SelectObject(dc, panelFont);
    SetTextColor(dc, RGB(236, 237, 239));
    RECT title{panelPixels(window, 36), 0, panelPixels(window, 246), area.bottom};
    std::wstring caption;
    { std::lock_guard lock(labelLock); caption = L"Computer Use · " + controlledApplicationName; }
    DrawTextW(dc, caption.c_str(), -1, &title, DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS | DT_NOPREFIX);
    const auto seconds = std::chrono::duration_cast<std::chrono::seconds>(Clock::now() - panelStartedAt).count();
    const auto elapsed = std::to_wstring(seconds / 60) + L":" + (seconds % 60 < 10 ? L"0" : L"") + std::to_wstring(seconds % 60);
    SelectObject(dc, panelTimerFont); SetTextColor(dc, RGB(169, 173, 182));
    RECT timer{panelPixels(window, 250), 0, panelPixels(window, 296), area.bottom};
    DrawTextW(dc, elapsed.c_str(), -1, &timer, DT_SINGLELINE | DT_VCENTER | DT_RIGHT | DT_NOPREFIX);
    SelectObject(dc, oldFont);
    auto moon = CreateSolidBrush(RGB(232, 182, 90));
    auto oldBrush = SelectObject(dc, moon); auto oldPen = SelectObject(dc, GetStockObject(NULL_PEN));
    Ellipse(dc, panelPixels(window, 12), panelPixels(window, 11), panelPixels(window, 28), panelPixels(window, 27));
    auto cutout = CreateSolidBrush(RGB(22, 23, 27)); SelectObject(dc, cutout);
    Ellipse(dc, panelPixels(window, 18), panelPixels(window, 9), panelPixels(window, 31), panelPixels(window, 27));
    SelectObject(dc, oldBrush); SelectObject(dc, oldPen); DeleteObject(moon); DeleteObject(cutout);
    EndPaint(window, &paint); return 0;
  }
  if (message == WM_DRAWITEM && w == 1) {
    auto item = reinterpret_cast<DRAWITEMSTRUCT*>(l);
    auto background = CreateSolidBrush(RGB(22, 23, 27)); FillRect(item->hDC, &item->rcItem, background); DeleteObject(background);
    auto fill = CreateSolidBrush((item->itemState & ODS_SELECTED) ? RGB(224, 99, 92) : RGB(242, 115, 107));
    auto oldBrush = SelectObject(item->hDC, fill); auto oldPen = SelectObject(item->hDC, GetStockObject(NULL_PEN));
    RoundRect(item->hDC, item->rcItem.left, item->rcItem.top, item->rcItem.right, item->rcItem.bottom, panelPixels(window, 30), panelPixels(window, 30));
    SelectObject(item->hDC, oldBrush); SelectObject(item->hDC, oldPen); DeleteObject(fill);
    SetBkMode(item->hDC, TRANSPARENT); SetTextColor(item->hDC, RGB(26, 11, 10));
    auto oldFont = SelectObject(item->hDC, panelFont);
    std::wstring caption; { std::lock_guard lock(labelLock); caption = L"■  " + stopLabel; }
    DrawTextW(item->hDC, caption.c_str(), -1, &item->rcItem, DT_SINGLELINE | DT_VCENTER | DT_CENTER | DT_NOPREFIX);
    SelectObject(item->hDC, oldFont); return TRUE;
  }
  if (message == WM_COMMAND && LOWORD(w) == 1) { paused(L"Native Stop button pressed"); return 0; }
  if (message == WM_CLOSE) { paused(L"Native Stop button pressed"); return 0; }
  if (message == WM_TIMER) {
    if (parent && WaitForSingleObject(parent, 0) != WAIT_TIMEOUT) { quit = true; ExitProcess(0); }
    if (IsWindowVisible(window)) {
      RECT timer{panelPixels(window, 250), 0, panelPixels(window, 296), panelPixels(window, 38)};
      InvalidateRect(window, &timer, FALSE);
    }
  }
  if (message == WM_DESTROY) {
    if (panelFont) DeleteObject(panelFont);
    if (panelTimerFont) DeleteObject(panelTimerFont);
    panelFont = panelTimerFont = nullptr;
  }
  return DefWindowProcW(window, message, w, l);
}
void Driver::inject(std::vector<INPUT> inputs, Observation const& observation) {
    valid(observation);
    require(desktopReady() && isControlledWindow(GetForegroundWindow()), "Foreground input unavailable on this desktop");
    for (auto& input : inputs) { if (input.type == INPUT_KEYBOARD) input.ki.dwExtraInfo = injected; else input.mi.dwExtraInfo = injected; }
    require(SendInput(static_cast<UINT>(inputs.size()), inputs.data(), sizeof(INPUT)) == inputs.size(),
            "Windows blocked input injection. Administrator applications and the UAC desktop cannot be controlled.");
  }
