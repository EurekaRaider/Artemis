#include "native.hpp"
std::wstring Driver::appIdentity(DWORD pid, std::wstring const& path) {
    UINT32 count = 0; HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    std::wstring id;
    if (process && GetApplicationUserModelId(process, &count, nullptr) == ERROR_INSUFFICIENT_BUFFER && count <= 32768) {
      id.resize(count); if (GetApplicationUserModelId(process, &count, id.data()) == ERROR_SUCCESS) id.resize(count - 1); else id.clear();
    }
    if (process) CloseHandle(process);
    if (!id.empty()) return L"win-" + sha(L"aumid:" + id);
    // Unsigned desktop binaries are identified by both canonical path and their file content.
    HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    require(file != INVALID_HANDLE_VALUE, "Cannot verify application identity");
    LARGE_INTEGER size{}; GetFileSizeEx(file, &size);
    if (size.QuadPart <= 0 || size.QuadPart > 512 * 1024 * 1024) { CloseHandle(file); throw std::runtime_error("Cannot verify application identity"); }
    std::wstring canonical(32768, L'\0');
    auto countPath = GetFinalPathNameByHandleW(file, canonical.data(), static_cast<DWORD>(canonical.size()), FILE_NAME_NORMALIZED);
    if (!countPath || countPath >= canonical.size()) { CloseHandle(file); throw std::runtime_error("Cannot verify application path"); }
    canonical.resize(countPath);
    std::transform(canonical.begin(), canonical.end(), canonical.begin(), [](wchar_t c) { return static_cast<wchar_t>(towlower(c)); });
    auto identityKey = canonical + L":" + std::to_wstring(size.QuadPart);
    FILETIME modified{}; GetFileTime(file, nullptr, nullptr, &modified);
    identityKey += L":" + std::to_wstring(modified.dwHighDateTime) + L":" + std::to_wstring(modified.dwLowDateTime);
    auto cached = identities.find(identityKey);
    if (cached != identities.end()) { CloseHandle(file); return cached->second; }
    std::vector<unsigned char> bytes(static_cast<size_t>(size.QuadPart)); DWORD read = 0;
    bool ok = ReadFile(file, bytes.data(), static_cast<DWORD>(bytes.size()), &read, nullptr) && read == bytes.size();
    CloseHandle(file); require(ok, "Cannot verify application identity");
    auto result = L"win-" + sha(canonical + L":" + sha(bytes.data(), bytes.size()));
    if (identities.size() >= 1000) identities.clear();
    identities[identityKey] = result; return result;
  }
RECT Driver::rectangle(HWND window) {
    RECT result{}; if (FAILED(DwmGetWindowAttribute(window, DWMWA_EXTENDED_FRAME_BOUNDS, &result, sizeof(result)))) GetWindowRect(window, &result);
    return result;
  }
JsonObject Driver::target(Application const& app) {
    JsonObject result; put(result, L"id", L"desktop:" + app.id); put(result, L"kind", std::wstring(L"desktop"));
    put(result, L"name", app.name); put(result, L"appId", app.id); return result;
  }
void Driver::discover() {
    applications.clear();
    EnumWindows([](HWND window, LPARAM parameter) -> BOOL {
      auto self = reinterpret_cast<Driver*>(parameter); auto pid = applicationPid(window);
      if (!IsWindowVisible(window) || GetWindow(window, GW_OWNER) || pid == GetCurrentProcessId() || pid == GetProcessId(parent)) return TRUE;
      auto path = processPath(pid); if (path.empty()) return TRUE;
      wchar_t title[512]{}; GetWindowTextW(window, title, 512); if (!*title) return TRUE;
      try {
        auto id = self->appIdentity(pid, path);
        self->applications[id] = {id, title, path, L"", window, pid};
      } catch (...) {} // Protected processes are not controllable targets.
      return TRUE;
    }, reinterpret_cast<LPARAM>(this));
    ComPtr<IShellItem> folder;
    if (SUCCEEDED(SHCreateItemFromParsingName(L"shell:AppsFolder", nullptr, IID_PPV_ARGS(&folder)))) {
      ComPtr<IEnumShellItems> items;
      if (SUCCEEDED(folder->BindToHandler(nullptr, BHID_EnumItems, IID_PPV_ARGS(&items)))) {
        ComPtr<IShellItem> item; ULONG fetched = 0; unsigned visited = 0;
        while (visited++ < 500 && items->Next(1, &item, &fetched) == S_OK) {
          ComPtr<IShellItem2> details; PWSTR aumid = nullptr, name = nullptr;
          if (SUCCEEDED(item.As(&details)) && SUCCEEDED(details->GetString(PKEY_AppUserModel_ID, &aumid)) && aumid &&
              SUCCEEDED(item->GetDisplayName(SIGDN_NORMALDISPLAY, &name)) && name) {
            auto id = L"win-" + sha(std::wstring(L"aumid:") + aumid);
            PWSTR targetPath = nullptr;
            std::wstring path;
            if (SUCCEEDED(details->GetString(PKEY_Link_TargetParsingPath, &targetPath)) && targetPath) {
              path = targetPath;
              try { id = appIdentity(0, path); } catch (...) { path.clear(); }
            }
            CoTaskMemFree(targetPath);
            if (!applications.contains(id)) applications[id] = {id, name, path, aumid, nullptr, 0};
          }
          CoTaskMemFree(aumid); CoTaskMemFree(name); item.Reset();
        }
      }
    }
  }
Application& Driver::find(JsonObject const& args, wchar_t const* key) {
    auto id = str(args, key); if (id.starts_with(L"desktop:")) id.erase(0, 8);
    auto found = applications.find(id); require(found != applications.end(), "Unknown application. List targets first.");
    return found->second;
  }
