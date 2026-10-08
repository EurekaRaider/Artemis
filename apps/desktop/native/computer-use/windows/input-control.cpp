#include "native.hpp"
std::mutex labelLock;
std::wstring stopLabel = L"Stop";
std::atomic<DWORD> controlledPid{0};
std::atomic<bool> foregroundControl{false}, quit{false};
std::atomic<unsigned> epoch{0};
HWND panel = nullptr;
std::atomic<HWND> controlledWindow{nullptr};
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
    std::lock_guard lock(labelLock);
    SetWindowTextW(GetDlgItem(window, 1), stopLabel.c_str());
    ShowWindow(window, SW_SHOWNOACTIVATE); return 0;
  }
  if (message == panelHide) { ShowWindow(window, SW_HIDE); return 0; }
  if (message == WM_COMMAND && LOWORD(w) == 1) { paused(L"Native Stop button pressed"); return 0; }
  if (message == WM_CLOSE) { paused(L"Native Stop button pressed"); return 0; }
  if (message == WM_TIMER && parent && WaitForSingleObject(parent, 0) != WAIT_TIMEOUT) { quit = true; ExitProcess(0); }
  return DefWindowProcW(window, message, w, l);
}
void Driver::inject(std::vector<INPUT> inputs, Observation const& observation) {
    valid(observation);
    require(desktopReady() && isControlledWindow(GetForegroundWindow()), "Foreground input unavailable on this desktop");
    for (auto& input : inputs) { if (input.type == INPUT_KEYBOARD) input.ki.dwExtraInfo = injected; else input.mi.dwExtraInfo = injected; }
    require(SendInput(static_cast<UINT>(inputs.size()), inputs.data(), sizeof(INPUT)) == inputs.size(),
            "Windows blocked input injection. Administrator applications and the UAC desktop cannot be controlled.");
  }
