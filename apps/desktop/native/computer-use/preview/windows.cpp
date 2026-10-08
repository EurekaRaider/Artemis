#include "preview.hpp"
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <wrl/client.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <algorithm>
#include <mutex>
#include <thread>
using Microsoft::WRL::ComPtr;
using namespace winrt;
using namespace winrt::Windows::Graphics::Capture;
using namespace winrt::Windows::Graphics::DirectX;
using namespace winrt::Windows::Graphics::DirectX::Direct3D11;
using ::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess;
static std::string processInstance(DWORD pid) {
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  FILETIME created{}, exited{}, kernel{}, user{};
  bool valid = process && GetProcessTimes(process, &created, &exited, &kernel, &user);
  if (process) CloseHandle(process);
  if (!valid) return "";
  return std::to_string(pid) + ":" + std::to_string(created.dwHighDateTime) + ":" + std::to_string(created.dwLowDateTime);
}
static bool interactiveDesktop() {
  auto desktop = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
  if (!desktop) return false;
  wchar_t name[256]{}; DWORD size;
  bool ready = GetUserObjectInformationW(desktop, UOI_NAME, name, sizeof(name), &size) && _wcsicmp(name, L"Default") == 0;
  CloseDesktop(desktop); return ready;
}
struct WindowsFrame : PreviewFrame {
  ComPtr<ID3D11Texture2D> texture;
  HANDLE shared = nullptr;
  void* handle() override { return shared; }
  const char* handleName() override { return "ntHandle"; }
  void dispose() override { if (shared) CloseHandle(shared); shared = nullptr; texture.Reset(); }
};
struct WindowsPreview : PreviewSession {
  HWND window; DWORD pid, windowPid; std::string instance, windowInstance, path;
  std::atomic<unsigned> maximum{1280};
  double nextFrameAt = 0;
  ComPtr<ID3D11Device> device; ComPtr<ID3D11DeviceContext> context;
  IDirect3DDevice captureDevice{nullptr};
  GraphicsCaptureItem item{nullptr}; Direct3D11CaptureFramePool pool{nullptr}; GraphicsCaptureSession stream{nullptr};
  event_token arrived{}, closed{};
  std::mutex mutex;
  std::atomic<bool> initialized{false};
  bool valid() {
    DWORD currentPid = 0; GetWindowThreadProcessId(window, &currentPid);
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    wchar_t executable[32768]{}; DWORD size = 32768;
    bool validPath = process && QueryFullProcessImageNameW(process, 0, executable, &size);
    if (process) CloseHandle(process);
    auto expected = to_hstring(path);
    return IsWindow(window) && !IsIconic(window) && currentPid == windowPid && processInstance(pid) == instance &&
      processInstance(windowPid) == windowInstance && validPath && _wcsicmp(executable, expected.c_str()) == 0 && interactiveDesktop();
  }
  void begin() {
    auto self = std::static_pointer_cast<WindowsPreview>(shared_from_this());
    std::thread([self] {
      init_apartment(apartment_type::multi_threaded);
      try {
        std::lock_guard lock(self->mutex);
        if (self->stopped) return;
        check_hresult(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
          D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT, nullptr, 0,
          D3D11_SDK_VERSION, &self->device, nullptr, &self->context));
        ComPtr<IDXGIDevice> dxgi; check_hresult(self->device.As(&dxgi));
        ComPtr<::IInspectable> inspectable;
        check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dxgi.Get(), &inspectable));
        check_hresult(inspectable->QueryInterface(guid_of<IDirect3DDevice>(), put_abi(self->captureDevice)));
        auto interop = get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
        check_hresult(interop->CreateForWindow(self->window, guid_of<GraphicsCaptureItem>(), put_abi(self->item)));
        auto size = self->item.Size();
        self->pool = Direct3D11CaptureFramePool::CreateFreeThreaded(self->captureDevice, DirectXPixelFormat::B8G8R8A8UIntNormalized, 3, size);
        self->stream = self->pool.CreateCaptureSession(self->item); self->stream.IsCursorCaptureEnabled(false);
        std::weak_ptr<WindowsPreview> weak = self;
        self->closed = self->item.Closed([weak](auto&, auto&) { if (auto session = weak.lock()) session->fail("Authorized window closed"); });
        self->arrived = self->pool.FrameArrived([weak, size](auto& sender, auto&) mutable {
          auto session = weak.lock(); if (!session || session->stopped) return;
          std::lock_guard lock(session->mutex);
          if (session->stopped) return;
          try {
            if (!session->valid()) throw std::runtime_error("Capture permission or application identity changed");
            auto frame = sender.TryGetNextFrame(); if (!frame) return;
            // Schedule against capture time rather than callback arrival jitter.
            // Advancing the deadline preserves 60 Hz instead of dropping every
            // other frame when a callback arrives slightly early.
            double capturedTime = double(frame.SystemRelativeTime().count()) / 10000;
            if (capturedTime + .5 < session->nextFrameAt) { frame.Close(); return; }
            session->nextFrameAt = std::max(session->nextFrameAt + 1000.0 / 60, capturedTime);
            auto content = frame.ContentSize();
            if (content.Width != size.Width || content.Height != size.Height) {
              frame.Close(); size = content;
              if (size.Width <= 0 || size.Height <= 0) throw std::runtime_error("Window is unavailable");
              sender.Recreate(session->captureDevice, DirectXPixelFormat::B8G8R8A8UIntNormalized, 3, size); return;
            }
            if (session->outstanding >= 3 || IsIconic(session->window)) { frame.Close(); return; }
            ComPtr<ID3D11Texture2D> source;
            check_hresult(frame.Surface().as<IDirect3DDxgiInterfaceAccess>()->GetInterface(IID_PPV_ARGS(&source)));
            double scale = std::min(1.0, double(session->maximum.load()) / std::max(content.Width, content.Height));
            auto output = std::make_unique<WindowsFrame>();
            LARGE_INTEGER counter{}, frequency{}; QueryPerformanceCounter(&counter); QueryPerformanceFrequency(&frequency);
            output->capturedAt = previewNow() - (double(counter.QuadPart) * 1000 / frequency.QuadPart - capturedTime);
            output->width = std::max(1u, unsigned(content.Width * scale)); output->height = std::max(1u, unsigned(content.Height * scale));
            D3D11_TEXTURE2D_DESC description{}; description.Width = output->width; description.Height = output->height;
            description.MipLevels = 1; description.ArraySize = 1; description.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
            description.SampleDesc.Count = 1; description.Usage = D3D11_USAGE_DEFAULT;
            description.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
            description.MiscFlags = D3D11_RESOURCE_MISC_SHARED_NTHANDLE | D3D11_RESOURCE_MISC_SHARED_KEYEDMUTEX;
            check_hresult(session->device->CreateTexture2D(&description, nullptr, &output->texture));
            ComPtr<IDXGIKeyedMutex> keyedMutex; check_hresult(output->texture.As(&keyedMutex));
            if (keyedMutex->AcquireSync(0, 100) != S_OK) throw std::runtime_error("GPU capture synchronization timed out");
            ComPtr<ID3D11VideoDevice> video; ComPtr<ID3D11VideoContext> videoContext;
            check_hresult(session->device.As(&video)); check_hresult(session->context.As(&videoContext));
            D3D11_VIDEO_PROCESSOR_CONTENT_DESC contentDescription{};
            contentDescription.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
            contentDescription.InputWidth = content.Width; contentDescription.InputHeight = content.Height;
            contentDescription.OutputWidth = output->width; contentDescription.OutputHeight = output->height;
            contentDescription.Usage = D3D11_VIDEO_USAGE_PLAYBACK_NORMAL;
            ComPtr<ID3D11VideoProcessorEnumerator> enumerator;
            check_hresult(video->CreateVideoProcessorEnumerator(&contentDescription, &enumerator));
            ComPtr<ID3D11VideoProcessor> processor; check_hresult(video->CreateVideoProcessor(enumerator.Get(), 0, &processor));
            D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC inputDescription{}; inputDescription.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D;
            D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC outputDescription{}; outputDescription.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
            ComPtr<ID3D11VideoProcessorInputView> input; ComPtr<ID3D11VideoProcessorOutputView> target;
            check_hresult(video->CreateVideoProcessorInputView(source.Get(), enumerator.Get(), &inputDescription, &input));
            check_hresult(video->CreateVideoProcessorOutputView(output->texture.Get(), enumerator.Get(), &outputDescription, &target));
            RECT sourceRect{0, 0, content.Width, content.Height}, destination{0, 0, LONG(output->width), LONG(output->height)};
            videoContext->VideoProcessorSetStreamSourceRect(processor.Get(), 0, TRUE, &sourceRect);
            videoContext->VideoProcessorSetStreamDestRect(processor.Get(), 0, TRUE, &destination);
            D3D11_VIDEO_PROCESSOR_STREAM operation{}; operation.Enable = TRUE; operation.pInputSurface = input.Get();
            check_hresult(videoContext->VideoProcessorBlt(processor.Get(), target.Get(), 0, 1, &operation));
            D3D11_QUERY_DESC queryDescription{D3D11_QUERY_EVENT, 0}; ComPtr<ID3D11Query> query;
            check_hresult(session->device->CreateQuery(&queryDescription, &query)); session->context->End(query.Get()); session->context->Flush();
            auto deadline = previewNow() + 100;
            HRESULT ready;
            while ((ready = session->context->GetData(query.Get(), nullptr, 0, 0)) == S_FALSE) {
              if (session->stopped || previewNow() > deadline) throw std::runtime_error("GPU capture synchronization timed out");
              SwitchToThread();
            }
            check_hresult(ready);
            // Chromium acquires shared textures with key zero. Each output is
            // immutable after this release and retained until GPU consumption.
            check_hresult(keyedMutex->ReleaseSync(0));
            frame.Close();
            ComPtr<IDXGIResource1> resource; check_hresult(output->texture.As(&resource));
            check_hresult(resource->CreateSharedHandle(nullptr, DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE, nullptr, &output->shared));
            output->owner = session; session->outstanding++; session->emit(output.release());
          } catch (const std::exception& error) { session->fail(error.what()); }
            catch (const hresult_error&) { session->fail("Windows GPU capture unavailable"); }
        });
        self->initialized = true; self->stream.StartCapture();
      } catch (...) { self->fail("Unable to start Windows GPU window capture"); }
      while (!self->stopped) {
        Sleep(100);
        if (!self->valid()) self->fail("Authorized window closed or desktop locked");
      }
    }).detach();
  }
  void stop() override {
    if (stopped.exchange(true)) return;
    auto self = std::static_pointer_cast<WindowsPreview>(shared_from_this());
    std::thread([self] {
      init_apartment(apartment_type::multi_threaded);
      GraphicsCaptureSession stream{nullptr}; Direct3D11CaptureFramePool pool{nullptr}; GraphicsCaptureItem item{nullptr};
      bool initialized;
      {
        std::lock_guard lock(self->mutex);
        initialized = self->initialized;
        stream = self->stream; pool = self->pool; item = self->item;
        self->stream = nullptr; self->pool = nullptr; self->item = nullptr;
      }
      try {
        if (initialized) { pool.FrameArrived(self->arrived); item.Closed(self->closed); }
        if (stream) stream.Close(); if (pool) pool.Close();
      } catch (...) {}
      napi_release_threadsafe_function(self->callback, napi_tsfn_release);
    }).detach();
  }
  void resize(unsigned value) override { maximum = value; }
};
napi_value startPreview(napi_env env, napi_callback_info info) {
  try {
    size_t count = 3; napi_value args[3]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    if (count != 3) throw std::runtime_error("Missing authorized window identity");
    auto session = std::make_shared<WindowsPreview>();
    session->window = reinterpret_cast<HWND>(std::stoull(textValue(env, args[0], "windowId")));
    session->pid = DWORD(numberValue(env, args[0], "pid")); session->windowPid = DWORD(numberValue(env, args[0], "windowPid"));
    session->instance = textValue(env, args[0], "processInstance"); session->windowInstance = textValue(env, args[0], "windowInstance");
    session->path = textValue(env, args[0], "appPath");
    unsigned maximum; napiCheck(napi_get_value_uint32(env, args[1], &maximum)); session->maximum = maximum;
    if ((maximum != 1280 && maximum != 1920) || !session->valid()) throw std::runtime_error("Invalid authorized window identity");
    initializeCallback(env, args[2], session); auto result = wrapSession(env, session); session->begin(); return result;
  } catch (const std::exception& error) { napi_throw_error(env, nullptr, error.what()); return nullptr; }
}
napi_value initialize(napi_env env, napi_value exports) {
  putNumber(env, exports, "protocol", 1);
  napi_property_descriptor descriptors[] = {
    {"start", nullptr, startPreview, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"stop", nullptr, stopPreview, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"resize", nullptr, resizePreview, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 3, descriptors); return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
