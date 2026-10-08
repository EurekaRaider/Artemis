#include "native.hpp"
std::wstring Driver::runtimeId(IUIAutomationElement* element) {
    SAFEARRAY* values = nullptr; check(element->GetRuntimeId(&values));
    require(values != nullptr, "Missing UI Automation identity");
    LONG lower = 0, upper = -1; SafeArrayGetLBound(values, 1, &lower); SafeArrayGetUBound(values, 1, &upper);
    std::wstring result;
    for (LONG i = lower; i <= upper && i < lower + 128; i++) { int value = 0; SafeArrayGetElement(values, &i, &value); result += L":" + std::to_wstring(value); }
    SafeArrayDestroy(values); return result;
  }
void Driver::valid(Observation const& observation) {
    require(desktopReady(), "Computer Use requires an unlocked interactive desktop.");
    require(observation.generation == epoch && controlledPid && IsWindow(observation.window) && !IsIconic(observation.window), "Computer Use paused or target closed. Observe again.");
    require(applicationPid(observation.window) == observation.processId && instance(observation.processId) == observation.processInstance, "Application restarted. Observe again.");
    auto bounds = rectangle(observation.window);
    require(EqualRect(&bounds, &observation.bounds), "Window moved. Observe again.");
    auto popup = GetLastActivePopup(observation.window);
    require(popup == observation.window || !IsWindowVisible(popup), "Modal window changed. Observe again.");
  }
Driver::Driver() {
    check(CoCreateInstance(CLSID_CUIAutomation8, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&automation)));
    ComPtr<IUIAutomation2> settings; if (SUCCEEDED(automation.As(&settings))) { settings->put_ConnectionTimeout(500); settings->put_TransactionTimeout(500); }
  }
