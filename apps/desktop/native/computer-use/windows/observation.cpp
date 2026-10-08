#include "native.hpp"
JsonObject Driver::observe(JsonObject const& args) {
    auto app = find(args, L"id");
    if (!app.window || !IsWindow(app.window)) {
      require(flag(args, L"allowForeground"), "foreground-required: Launching this Windows application needs foreground permission. Open it manually or grant foreground access.");
      require(!app.aumid.empty(), "Application closed. Open it and retry.");
      auto launchGeneration = epoch.load();
      controlledPid = GetCurrentProcessId(); controlledWindow = nullptr; foregroundControl = true;
      auto launch = L"shell:AppsFolder\\" + app.aumid;
      SHELLEXECUTEINFOW execute{}; execute.cbSize = sizeof(execute); execute.fMask = SEE_MASK_NOASYNC;
      execute.lpFile = launch.c_str(); execute.nShow = SW_SHOWNORMAL;
      require(ShellExecuteExW(&execute), "Windows could not launch this application.");
      auto deadline = Clock::now() + std::chrono::seconds(2);
      do { Sleep(50); discover(); app = find(args, L"id"); } while (!app.window && Clock::now() < deadline && launchGeneration == epoch);
      require(launchGeneration == epoch, "Application launch paused by user input");
    }
    auto window = app.window; auto popup = GetLastActivePopup(window);
    if (popup && IsWindowVisible(popup) && pidOf(popup) == pidOf(window)) window = popup;
    require(desktopReady() && IsWindow(window) && !IsIconic(window), "Open a visible application window on the interactive desktop.");
    RECT bounds = rectangle(window); require(bounds.right > bounds.left && bounds.bottom > bounds.top, "Window has no geometry");
    Observation observation{window, bounds, std::min(1.0, 1280.0 / std::max(bounds.right - bounds.left, bounds.bottom - bounds.top)), instance(app.processId), epoch.load(), app.processId};
    controlledPid = app.processId;
    controlledWindow = window;
    { std::lock_guard lock(labelLock); stopLabel = str(args, L"stopLabel", L"Stop"); }
    PostMessageW(panel, panelShow, 0, 0);
    elements.clear(); JsonArray nodes; JsonArray revisionNodes;
    ComPtr<IUIAutomationElement> root; check(automation->ElementFromHandle(window, &root));
    ComPtr<IUIAutomationTreeWalker> walker; check(automation->get_ControlViewWalker(&walker));
    unsigned visited = 0; auto deadline = Clock::now() + std::chrono::milliseconds(1400);
    std::function<void(ComPtr<IUIAutomationElement>, int)> visit = [&](ComPtr<IUIAutomationElement> element, int depth) {
      if (!element || depth > 12 || ++visited > 1000 || nodes.Size() >= 250 || Clock::now() > deadline) return;
      BOOL password = FALSE; if (FAILED(element->get_CurrentIsPassword(&password)) || password) return;
      RECT area{}; if (SUCCEEDED(element->get_CurrentBoundingRectangle(&area)) && area.right > area.left && area.bottom > area.top) {
        auto identity = L"uia:" + sha(observation.processInstance + std::to_wstring(reinterpret_cast<uintptr_t>(window)) + runtimeId(element.Get()));
        JsonObject node; put(node, L"id", identity); put(node, L"label", std::wstring()); elements[identity] = element;
        CONTROLTYPEID type = 0; element->get_CurrentControlType(&type); put(node, L"role", L"UIA:" + std::to_wstring(type));
        BSTR name = nullptr; element->get_CurrentName(&name);
        if (name) { put(node, L"label", std::wstring(name, std::min<size_t>(SysStringLen(name), 500))); SysFreeString(name); }
        JsonObject position; put(position, L"x", (area.left - bounds.left) * observation.scale); put(position, L"y", (area.top - bounds.top) * observation.scale);
        put(position, L"width", (area.right - area.left) * observation.scale); put(position, L"height", (area.bottom - area.top) * observation.scale); node.SetNamedValue(L"bounds", position);
        BOOL enabled = FALSE; element->get_CurrentIsEnabled(&enabled); put(node, L"enabled", !!enabled);
        JsonObject structural = JsonObject::Parse(node.Stringify()); revisionNodes.Append(structural);
        ComPtr<IUIAutomationValuePattern> value;
        if (SUCCEEDED(element->GetCurrentPatternAs(UIA_ValuePatternId, IID_PPV_ARGS(&value))) && value) {
          BSTR text = nullptr; if (SUCCEEDED(value->get_CurrentValue(&text)) && text) {
            std::wstring full(text, SysStringLen(text)); put(node, L"value", full.substr(0, 2000)); put(node, L"valueDigest", sha(full)); SysFreeString(text);
          }
        }
        nodes.Append(node);
      }
      ComPtr<IUIAutomationElement> child; walker->GetFirstChildElement(element.Get(), &child);
      while (child && Clock::now() < deadline && visited < 1000 && nodes.Size() < 250) {
        visit(child, depth + 1); ComPtr<IUIAutomationElement> next; walker->GetNextSiblingElement(child.Get(), &next); child = next;
      }
    };
    visit(root, 0); valid(observation); observations[str(args, L"id")] = observation;
    JsonObject frame; auto scope = observation.processInstance + L":" + std::to_wstring(reinterpret_cast<uintptr_t>(window)) + L":" + std::to_wstring(bounds.left) + L":" + std::to_wstring(bounds.top) + L":" + std::to_wstring(bounds.right) + L":" + std::to_wstring(bounds.bottom);
    put(frame, L"revision", sha(scope + std::wstring(revisionNodes.Stringify()))); put(frame, L"scopeRevision", sha(scope));
    put(frame, L"foreground", isControlledWindow(GetForegroundWindow()));
    put(frame, L"width", std::floor((bounds.right - bounds.left) * observation.scale)); put(frame, L"height", std::floor((bounds.bottom - bounds.top) * observation.scale)); frame.SetNamedValue(L"elements", nodes);
    if (flag(args, L"image")) {
      auto jpeg = capture(window, observation.generation); valid(observation);
      DWORD count = 0; require(CryptBinaryToStringA(jpeg.data(), static_cast<DWORD>(jpeg.size()), CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, nullptr, &count), "Cannot encode screenshot");
      std::string base64(count, '\0'); require(CryptBinaryToStringA(jpeg.data(), static_cast<DWORD>(jpeg.size()), CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, base64.data(), &count), "Cannot encode screenshot");
      base64.resize(count && base64[count - 1] == '\0' ? count - 1 : count);
      JsonObject image; put(image, L"mimeType", std::wstring(L"image/jpeg")); put(image, L"data", std::wstring(to_hstring(base64))); frame.SetNamedValue(L"image", image);
      put(frame, L"visualRevision", sha(jpeg.data(), jpeg.size()));
    }
    return frame;
  }
