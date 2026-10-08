#include "native.hpp"

int main() {
  try {
    verifyParent(); SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2); init_apartment(apartment_type::single_threaded);
    WNDCLASSW definition{}; definition.lpfnWndProc = panelProc; definition.hInstance = GetModuleHandleW(nullptr); definition.lpszClassName = L"ArtemisComputerStop"; definition.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1); RegisterClassW(&definition);
    panel = CreateWindowExW(WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, definition.lpszClassName, L"Artemis Computer Use", WS_POPUP | WS_BORDER, 24, 24, 200, 54, nullptr, nullptr, definition.hInstance, nullptr);
    require(panel != nullptr, "Native Stop control unavailable");
    CreateWindowW(L"BUTTON", L"Stop", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON, 8, 8, 184, 36, panel, reinterpret_cast<HMENU>(1), definition.hInstance, nullptr);
    auto keyboard = SetWindowsHookExW(WH_KEYBOARD_LL, keyboardHook, definition.hInstance, 0); auto mouse = SetWindowsHookExW(WH_MOUSE_LL, mouseHook, definition.hInstance, 0);
    require(keyboard && mouse, "User takeover monitoring unavailable"); SetTimer(panel, 1, 500, nullptr);
    std::thread worker([] {
      init_apartment(apartment_type::multi_threaded);
      try {
        Driver driver; std::string line; line.reserve(131072); char byte;
        while (!quit && std::cin.get(byte)) {
          if (byte != '\n') { require(line.size() < 131072, "Native request exceeds limit"); line += byte; continue; }
          JsonObject reply;
          try {
            auto request = JsonObject::Parse(to_hstring(line)); put(reply, L"id", str(request, L"id"));
            require(str(request, L"id").size() <= 100, "Invalid request id"); reply.SetNamedValue(L"result", driver.handle(request));
          } catch (hresult_error const& error) { put(reply, L"error", std::wstring(error.message())); }
          catch (std::exception const& error) { put(reply, L"error", std::wstring(to_hstring(error.what()))); }
          emit(reply); line.clear();
        }
      } catch (...) {}
      quit = true; PostThreadMessageW(GetWindowThreadProcessId(panel, nullptr), WM_QUIT, 0, 0);
    });
    MSG message{}; while (GetMessageW(&message, nullptr, 0, 0) > 0) { TranslateMessage(&message); DispatchMessageW(&message); }
    worker.join(); UnhookWindowsHookEx(keyboard); UnhookWindowsHookEx(mouse); CloseHandle(parent); return 0;
  } catch (...) { return 1; }
}
