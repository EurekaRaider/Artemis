#pragma once
// Windows 11 x64 native Computer Use. Only private pipes are used; no socket or command execution.
#include <windows.h>
#include <objbase.h>
#include <oleauto.h>
#include <tlhelp32.h>
#include <uiautomation.h>
#include <dwmapi.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <wincodec.h>
#include <bcrypt.h>
#include <wincrypt.h>
#include <shlobj.h>
#include <shellapi.h>
#include <propkey.h>
#include <appmodel.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <cstring>
#include <cmath>
#include <stdexcept>
#include <wrl/client.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cwctype>
#include <functional>
#include <iostream>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using Microsoft::WRL::ComPtr;
using namespace winrt;
using namespace winrt::Windows::Data::Json;
using namespace winrt::Windows::Graphics::Capture;
using namespace winrt::Windows::Graphics::DirectX;
using namespace winrt::Windows::Graphics::DirectX::Direct3D11;
using ::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess;
using Clock = std::chrono::steady_clock;
// Mouse injection may retain only the low 32 bits across Windows input proxies.
constexpr ULONG_PTR injected = 0x41525453;
constexpr UINT panelShow = WM_APP + 1, panelHide = WM_APP + 2;
extern std::mutex labelLock;
extern std::wstring stopLabel;
extern std::atomic<DWORD> controlledPid;
extern std::atomic<bool> foregroundControl, quit;
extern std::atomic<unsigned> epoch;
extern HWND panel;
extern std::atomic<HWND> controlledWindow;
extern HANDLE parent;
void require(bool value, const char* message);
void check(HRESULT result);
std::wstring str(JsonObject const& object, wchar_t const* key, std::wstring fallback = L"");
bool flag(JsonObject const& object, wchar_t const* key);
double number(JsonObject const& object, wchar_t const* key, double fallback = 0);
void put(JsonObject& object, wchar_t const* key, std::wstring const& value);
void put(JsonObject& object, wchar_t const* key, double value);
void put(JsonObject& object, wchar_t const* key, bool value);
void emit(JsonObject const& object);
std::wstring sha(void const* data, size_t size);
std::wstring sha(std::wstring const& value);
std::wstring processPath(DWORD pid);
std::wstring instance(DWORD pid);
DWORD pidOf(HWND window);
DWORD applicationPid(HWND window);
bool isControlledWindow(HWND window);
bool desktopReady();
void verifyParent();
void paused(wchar_t const* reason);
LRESULT CALLBACK keyboardHook(int code, WPARAM key, LPARAM data);
LRESULT CALLBACK mouseHook(int code, WPARAM key, LPARAM data);
LRESULT CALLBACK panelProc(HWND window, UINT message, WPARAM w, LPARAM l);

struct Application { std::wstring id, name, path, aumid; HWND window = nullptr; DWORD processId = 0; };
struct Observation { HWND window = nullptr; RECT bounds{}; double scale = 1; std::wstring processInstance; unsigned generation = 0; DWORD processId = 0; };
class Driver {
  ComPtr<IUIAutomation> automation;
  std::map<std::wstring, Application> applications;
  std::map<std::wstring, ComPtr<IUIAutomationElement>> elements;
  std::map<std::wstring, Observation> observations;
  std::map<std::wstring, std::wstring> identities;
  ComPtr<ID3D11Device> device;
  ComPtr<ID3D11DeviceContext> deviceContext;
  IDirect3DDevice captureDevice{nullptr};

  std::wstring appIdentity(DWORD pid, std::wstring const& path);
  static RECT rectangle(HWND window);
  JsonObject target(Application const& app);
  void discover();
  Application& find(JsonObject const& args, wchar_t const* key);
  static std::wstring runtimeId(IUIAutomationElement* element);
  void valid(Observation const& observation);
  std::vector<unsigned char> capture(HWND window, unsigned generation);
  void inject(std::vector<INPUT> inputs, Observation const& observation);
public:
  Driver();
  JsonObject observe(JsonObject const& args);
  void act(JsonObject const& args);
  IJsonValue handle(JsonObject const& request);
};
