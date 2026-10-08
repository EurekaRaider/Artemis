#include "native.hpp"
std::mutex outputLock;
HANDLE parent = nullptr;
void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
void check(HRESULT result) { check_hresult(result); }
std::wstring str(JsonObject const& object, wchar_t const* key, std::wstring fallback) {
  return std::wstring(object.GetNamedString(key, hstring(fallback)));
}
bool flag(JsonObject const& object, wchar_t const* key) { return object.GetNamedBoolean(key, false); }
double number(JsonObject const& object, wchar_t const* key, double fallback) { return object.GetNamedNumber(key, fallback); }
void put(JsonObject& object, wchar_t const* key, std::wstring const& value) { object.SetNamedValue(key, JsonValue::CreateStringValue(value)); }
void put(JsonObject& object, wchar_t const* key, double value) { object.SetNamedValue(key, JsonValue::CreateNumberValue(value)); }
void put(JsonObject& object, wchar_t const* key, bool value) { object.SetNamedValue(key, JsonValue::CreateBooleanValue(value)); }
void emit(JsonObject const& object) {
  auto encoded = to_string(object.Stringify());
  require(encoded.size() <= 2 * 1024 * 1024, "Native response is too large");
  std::lock_guard lock(outputLock);
  std::cout << encoded << '\n' << std::flush;
}
std::wstring sha(void const* data, size_t size) {
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  require(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) >= 0, "Hash unavailable");
  unsigned char digest[32]{};
  auto status = BCryptHash(algorithm, nullptr, 0, const_cast<PUCHAR>(static_cast<unsigned char const*>(data)),
                           static_cast<ULONG>(size), digest, sizeof(digest));
  BCryptCloseAlgorithmProvider(algorithm, 0);
  require(status >= 0, "Hash failed");
  static wchar_t const hex[] = L"0123456789abcdef";
  std::wstring result;
  for (auto byte : digest) { result += hex[byte >> 4]; result += hex[byte & 15]; }
  return result;
}
std::wstring sha(std::wstring const& value) { auto utf8 = to_string(value); return sha(utf8.data(), utf8.size()); }
std::wstring processPath(DWORD pid) {
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!process) return {};
  std::wstring result(32768, L'\0'); DWORD count = static_cast<DWORD>(result.size());
  if (!QueryFullProcessImageNameW(process, 0, result.data(), &count)) count = 0;
  CloseHandle(process); result.resize(count);
  std::transform(result.begin(), result.end(), result.begin(), [](wchar_t c) { return static_cast<wchar_t>(towlower(c)); });
  return result;
}
std::wstring instance(DWORD pid) {
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  FILETIME created{}, exited{}, kernel{}, user{};
  bool success = process && GetProcessTimes(process, &created, &exited, &kernel, &user);
  if (process) CloseHandle(process);
  require(success, "Application is no longer available");
  return std::to_wstring(pid) + L":" + std::to_wstring(created.dwHighDateTime) + L":" + std::to_wstring(created.dwLowDateTime);
}
DWORD pidOf(HWND window) { DWORD pid = 0; GetWindowThreadProcessId(window, &pid); return pid; }
// Legacy UWP windows may share ApplicationFrameHost; never grant that shared PID as an app identity.
DWORD applicationPid(HWND window) {
  auto owner = pidOf(window);
  auto path = processPath(owner);
  if (!path.ends_with(L"\\applicationframehost.exe")) return owner;
  DWORD application = 0;
  EnumChildWindows(window, [](HWND child, LPARAM parameter) -> BOOL {
    auto candidate = pidOf(child); UINT32 count = 0;
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, candidate);
    bool packaged = process && GetApplicationUserModelId(process, &count, nullptr) == ERROR_INSUFFICIENT_BUFFER;
    if (process) CloseHandle(process);
    if (packaged) { *reinterpret_cast<DWORD*>(parameter) = candidate; return FALSE; }
    return TRUE;
  }, reinterpret_cast<LPARAM>(&application));
  return application;
}
bool isControlledWindow(HWND window) {
  auto target = controlledWindow.load();
  return target && window && GetAncestor(window, GA_ROOTOWNER) == GetAncestor(target, GA_ROOTOWNER);
}
bool desktopReady() {
  auto desktop = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
  if (!desktop) return false;
  wchar_t name[256]{}; DWORD needed = 0;
  bool ready = GetUserObjectInformationW(desktop, UOI_NAME, name, sizeof(name), &needed) && _wcsicmp(name, L"Default") == 0;
  CloseDesktop(desktop); return ready;
}
void verifyParent() {
  require(GetFileType(GetStdHandle(STD_INPUT_HANDLE)) == FILE_TYPE_PIPE && GetFileType(GetStdHandle(STD_OUTPUT_HANDLE)) == FILE_TYPE_PIPE, "Private parent pipes required");
  auto snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  PROCESSENTRY32W entry{}; entry.dwSize = sizeof(entry); DWORD parentPid = 0;
  if (Process32FirstW(snapshot, &entry)) do { if (entry.th32ProcessID == GetCurrentProcessId()) { parentPid = entry.th32ParentProcessID; break; } } while (Process32NextW(snapshot, &entry));
  CloseHandle(snapshot);
  wchar_t expected[32768]{}; auto length = GetEnvironmentVariableW(L"ARTEMIS_COMPUTER_PARENT", expected, 32768);
  require(length > 0 && length < 32768 && parentPid, "Untrusted Computer Use parent");
  std::wstring path = expected;
  std::transform(path.begin(), path.end(), path.begin(), [](wchar_t c) { return static_cast<wchar_t>(towlower(c)); });
  auto name = path.substr(path.find_last_of(L"\\/") + 1);
  bool allowed = name == L"artemis.exe";
#ifdef _DEBUG
  allowed = allowed || name == L"electron.exe";
#endif
  require(allowed && processPath(parentPid) == path, "Untrusted Computer Use parent");
  parent = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, parentPid);
  require(parent != nullptr, "Computer Use parent is unavailable");
}

IJsonValue Driver::handle(JsonObject const& request) {
    auto method = str(request, L"method"); auto args = request.GetNamedObject(L"args", JsonObject());
    if (method == L"hello") { JsonObject result; put(result, L"helperProtocol", 1.0); put(result, L"platform", std::wstring(L"win32")); put(result, L"previewIdentity", 1.0); return result; }
    if (method == L"status" || method == L"permissions") {
      JsonObject result; bool ready = desktopReady();
      put(result, L"platform", std::wstring(L"win32")); put(result, L"helperProtocol", 1.0); put(result, L"accessibility", ready); put(result, L"screenRecording", ready && GraphicsCaptureSession::IsSupported());
      put(result, L"automationReady", ready); put(result, L"captureReady", ready && GraphicsCaptureSession::IsSupported()); put(result, L"interactiveDesktop", ready);
      if (!ready) put(result, L"reason", std::wstring(L"An unlocked Windows interactive desktop is required.")); return result;
    }
    if (method == L"targets") { discover(); JsonArray targets; for (auto const& [id, app] : applications) targets.Append(target(app)); return targets; }
    if (method == L"open") { discover(); return target(find(args, L"target")); }
    if (method == L"preview-identity") {
      auto id = str(args, L"id"); auto found = observations.find(id);
      require(found != observations.end(), "Observe the authorized window before previewing");
      auto observation = found->second; valid(observation);
      auto app = applications.find(id.starts_with(L"desktop:") ? id.substr(8) : id); require(app != applications.end(), "Application identity is unavailable");
      JsonObject result; put(result, L"version", 1.0); put(result, L"platform", std::wstring(L"win32")); put(result, L"targetId", id);
      put(result, L"pid", double(observation.processId)); put(result, L"processInstance", observation.processInstance);
      put(result, L"windowId", std::to_wstring(reinterpret_cast<uintptr_t>(observation.window)));
      auto windowPid = pidOf(observation.window); put(result, L"windowPid", double(windowPid)); put(result, L"windowInstance", instance(windowPid));
      put(result, L"appIdentity", app->second.id); put(result, L"appPath", processPath(observation.processId)); return result;
    }
    if (method == L"observe") return observe(args);
    if (method == L"act") { act(args); return JsonObject(); }
    if (method == L"release") { observations.erase(str(args, L"id")); elements.clear(); controlledPid = 0; controlledWindow = nullptr; foregroundControl = false; PostMessageW(panel, panelHide, 0, 0); return JsonObject(); }
    throw std::runtime_error("Unknown native method");
  }
