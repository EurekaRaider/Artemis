#include "native.hpp"
void Driver::act(JsonObject const& args) {
    auto found = observations.find(str(args, L"id")); require(found != observations.end(), "Observe the application first");
    auto observation = found->second; valid(observation); auto action = args.GetNamedObject(L"action"); auto type = str(action, L"type");
    if (type == L"click" || type == L"fill") {
      auto element = elements.find(str(action, L"elementId")); require(element != elements.end(), "Element is stale");
      BOOL password = TRUE, enabled = FALSE; check(element->second->get_CurrentIsPassword(&password)); check(element->second->get_CurrentIsEnabled(&enabled));
      require(!password && enabled, "Cannot operate this control");
      int owner = 0; check(element->second->get_CurrentProcessId(&owner)); require((owner == static_cast<int>(observation.processId) || owner == static_cast<int>(pidOf(observation.window))), "Control belongs to a different application");
      // Legacy MSAA proxy patterns may activate the window, including Value.
      // Require foreground permission before calling that provider.
      if (!isControlledWindow(GetForegroundWindow())) {
        BSTR provider = nullptr; check(element->second->get_CurrentProviderDescription(&provider));
        std::wstring description = provider ? std::wstring(provider, SysStringLen(provider)) : std::wstring(); SysFreeString(provider);
        if (description.find(L"MSAA Proxy") != std::wstring::npos)
          require(flag(args, L"allowForeground"), "foreground-required: This legacy accessibility provider may activate the application. Grant foreground permission before operating this control.");
      }
      if (flag(args, L"allowForeground")) foregroundControl = true;
      if (type == L"fill") {
        auto text = str(action, L"text"); require(text.size() <= 16000, "Text exceeds field limit");
        ComPtr<IUIAutomationValuePattern> value; require(SUCCEEDED(element->second->GetCurrentPatternAs(UIA_ValuePatternId, IID_PPV_ARGS(&value))) && value, "foreground-required: This field does not support background editing.");
        BOOL readOnly = TRUE; check(value->get_CurrentIsReadOnly(&readOnly)); require(!readOnly, "Field is read only");
        BSTR encoded = SysAllocStringLen(text.data(), static_cast<UINT>(text.size()));
        require(encoded != nullptr, "Cannot allocate field value");
        auto result = value->SetValue(encoded); SysFreeString(encoded); check(result);
      } else {
        ComPtr<IUIAutomationInvokePattern> invoke; ComPtr<IUIAutomationTogglePattern> toggle; ComPtr<IUIAutomationSelectionItemPattern> selection;
        if (SUCCEEDED(element->second->GetCurrentPatternAs(UIA_InvokePatternId, IID_PPV_ARGS(&invoke))) && invoke) check(invoke->Invoke());
        else if (SUCCEEDED(element->second->GetCurrentPatternAs(UIA_TogglePatternId, IID_PPV_ARGS(&toggle))) && toggle) check(toggle->Toggle());
        else if (SUCCEEDED(element->second->GetCurrentPatternAs(UIA_SelectionItemPatternId, IID_PPV_ARGS(&selection))) && selection) check(selection->Select());
        else throw std::runtime_error("foreground-required: This control does not support background clicking.");
      }
      require(observation.generation == epoch, "Control paused by user input"); return;
    }
    require(flag(args, L"allowForeground"), "foreground-required: Foreground input requires separate user permission.");
    foregroundControl = true; SetForegroundWindow(observation.window);
    auto deadline = Clock::now() + std::chrono::milliseconds(750);
    while (!isControlledWindow(GetForegroundWindow()) && Clock::now() < deadline && observation.generation == epoch) Sleep(10);
    std::vector<INPUT> inputs;
    if (type == L"click_at") {
      auto x = number(action, L"x", -1), y = number(action, L"y", -1);
      require(x >= 0 && y >= 0 && x < (observation.bounds.right - observation.bounds.left) * observation.scale && y < (observation.bounds.bottom - observation.bounds.top) * observation.scale, "Coordinates are outside the window");
      POINT point{observation.bounds.left + static_cast<LONG>(x / observation.scale), observation.bounds.top + static_cast<LONG>(y / observation.scale)};
      require(isControlledWindow(WindowFromPoint(point)), "Target window is covered");
      INPUT move{}; move.type = INPUT_MOUSE; move.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
      move.mi.dx = MulDiv(point.x - GetSystemMetrics(SM_XVIRTUALSCREEN), 65535, std::max(1, GetSystemMetrics(SM_CXVIRTUALSCREEN) - 1));
      move.mi.dy = MulDiv(point.y - GetSystemMetrics(SM_YVIRTUALSCREEN), 65535, std::max(1, GetSystemMetrics(SM_CYVIRTUALSCREEN) - 1)); inputs.push_back(move);
      INPUT down{}; down.type = INPUT_MOUSE; down.mi.dwFlags = MOUSEEVENTF_LEFTDOWN; inputs.push_back(down); down.mi.dwFlags = MOUSEEVENTF_LEFTUP; inputs.push_back(down);
    } else if (type == L"key") {
      std::map<std::wstring, int> keys{{L"Enter", VK_RETURN}, {L"Tab", VK_TAB}, {L"Escape", VK_ESCAPE}, {L"Backspace", VK_BACK}, {L"ArrowUp", VK_UP}, {L"ArrowDown", VK_DOWN}, {L"ArrowLeft", VK_LEFT}, {L"ArrowRight", VK_RIGHT}, {L"Space", VK_SPACE}};
      auto key = keys.find(str(action, L"key")); require(key != keys.end(), "Unsupported key");
      std::map<std::wstring, int> modifiers{{L"Meta", VK_LWIN}, {L"Control", VK_CONTROL}, {L"Alt", VK_MENU}, {L"Shift", VK_SHIFT}};
      std::vector<WORD> pressed;
      for (auto modifier : action.GetNamedArray(L"modifiers", JsonArray())) { auto match = modifiers.find(std::wstring(modifier.GetString())); require(match != modifiers.end(), "Unsupported modifier"); pressed.push_back(static_cast<WORD>(match->second)); }
      pressed.push_back(static_cast<WORD>(key->second));
      for (auto code : pressed) { INPUT input{}; input.type = INPUT_KEYBOARD; input.ki.wVk = code; if (code == VK_LWIN || (code >= VK_LEFT && code <= VK_DOWN)) input.ki.dwFlags = KEYEVENTF_EXTENDEDKEY; inputs.push_back(input); }
      for (auto i = pressed.rbegin(); i != pressed.rend(); ++i) { INPUT input{}; input.type = INPUT_KEYBOARD; input.ki.wVk = *i; input.ki.dwFlags = KEYEVENTF_KEYUP | ((*i == VK_LWIN || (*i >= VK_LEFT && *i <= VK_DOWN)) ? KEYEVENTF_EXTENDEDKEY : 0); inputs.push_back(input); }
    } else if (type == L"scroll") {
      auto direction = str(action, L"direction"); auto amount = number(action, L"amount");
      require(amount > 0 && amount <= 1000 && (direction == L"up" || direction == L"down" || direction == L"left" || direction == L"right"), "Invalid scroll");
      POINT point{}; GetCursorPos(&point);
      if (!PtInRect(&observation.bounds,point) || !isControlledWindow(WindowFromPoint(point)))
        point = {observation.bounds.left + (observation.bounds.right-observation.bounds.left)/2, observation.bounds.top + (observation.bounds.bottom-observation.bounds.top)/2};
      require(isControlledWindow(WindowFromPoint(point)), "Target window is covered");
      INPUT move{}; move.type=INPUT_MOUSE; move.mi.dwFlags=MOUSEEVENTF_MOVE|MOUSEEVENTF_ABSOLUTE|MOUSEEVENTF_VIRTUALDESK;
      move.mi.dx=MulDiv(point.x-GetSystemMetrics(SM_XVIRTUALSCREEN),65535,std::max(1,GetSystemMetrics(SM_CXVIRTUALSCREEN)-1));
      move.mi.dy=MulDiv(point.y-GetSystemMetrics(SM_YVIRTUALSCREEN),65535,std::max(1,GetSystemMetrics(SM_CYVIRTUALSCREEN)-1)); inputs.push_back(move);
      INPUT wheel{}; wheel.type = INPUT_MOUSE; wheel.mi.dwFlags = direction == L"left" || direction == L"right" ? MOUSEEVENTF_HWHEEL : MOUSEEVENTF_WHEEL;
      wheel.mi.mouseData = static_cast<DWORD>(static_cast<LONG>((direction == L"up" || direction == L"right" ? 1 : -1) * amount)); inputs.push_back(wheel);
    } else throw std::runtime_error("Unsupported action");
    inject(inputs, observation);
  }
