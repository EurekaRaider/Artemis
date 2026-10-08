#include "native.hpp"
std::vector<unsigned char> Driver::capture(HWND window, unsigned generation) {
    if (!captureDevice) {
      check(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0,
                             D3D11_SDK_VERSION, &device, nullptr, &deviceContext));
      ComPtr<IDXGIDevice> dxgi; check(device.As(&dxgi));
      ComPtr<::IInspectable> inspectable; check(CreateDirect3D11DeviceFromDXGIDevice(dxgi.Get(), &inspectable));
      check(inspectable->QueryInterface(guid_of<IDirect3DDevice>(), put_abi(captureDevice)));
    }
    auto interop = get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
    GraphicsCaptureItem item{nullptr};
    check(interop->CreateForWindow(window, guid_of<GraphicsCaptureItem>(), put_abi(item)));
    auto size = item.Size();
    require(size.Width > 0 && size.Height > 0 && size.Width <= 16384 && size.Height <= 16384, "Invalid capture dimensions");
    auto pool = Direct3D11CaptureFramePool::CreateFreeThreaded(captureDevice, DirectXPixelFormat::B8G8R8A8UIntNormalized, 1, size);
    auto session = pool.CreateCaptureSession(item); session.IsCursorCaptureEnabled(false); session.StartCapture();
    Direct3D11CaptureFrame frame{nullptr}; auto deadline = Clock::now() + std::chrono::milliseconds(750);
    while (!frame && Clock::now() < deadline && generation == epoch) { frame = pool.TryGetNextFrame(); if (!frame) Sleep(10); }
    session.Close();
    require(frame != nullptr && generation == epoch, "Window capture unavailable or control paused");
    auto surface = frame.Surface().as<IDirect3DDxgiInterfaceAccess>();
    ComPtr<ID3D11Texture2D> texture; check(surface->GetInterface(IID_PPV_ARGS(&texture)));
    D3D11_TEXTURE2D_DESC description{}; texture->GetDesc(&description);
    require(description.Width <= 16384 && description.Height <= 16384 && description.Width * uint64_t(description.Height) <= 64 * 1024 * 1024, "Capture is too large");
    auto content = frame.ContentSize();
    require(content.Width == size.Width && content.Height == size.Height, "Capture resized. Observe again.");
    auto bounds = rectangle(window);
    require(size.Width == bounds.right - bounds.left && size.Height == bounds.bottom - bounds.top, "Capture geometry changed. Observe again.");
    auto width = static_cast<UINT>(content.Width), height = static_cast<UINT>(content.Height);
    require(width <= description.Width && height <= description.Height, "Invalid capture surface");
    description.Usage = D3D11_USAGE_STAGING; description.BindFlags = 0; description.MiscFlags = 0; description.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    ComPtr<ID3D11Texture2D> staging; check(device->CreateTexture2D(&description, nullptr, &staging));
    deviceContext->CopyResource(staging.Get(), texture.Get()); D3D11_MAPPED_SUBRESOURCE mapped{};
    check(deviceContext->Map(staging.Get(), 0, D3D11_MAP_READ, 0, &mapped));
    std::vector<unsigned char> pixels(width * height * 4);
    for (unsigned y = 0; y < height; y++) memcpy(pixels.data() + y * width * 4, static_cast<unsigned char*>(mapped.pData) + y * mapped.RowPitch, width * 4);
    deviceContext->Unmap(staging.Get(), 0); frame.Close(); pool.Close();
    ComPtr<IWICImagingFactory> factory; check(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory)));
    ComPtr<IWICBitmap> bitmap; check(factory->CreateBitmapFromMemory(width, height, GUID_WICPixelFormat32bppBGRA, width * 4, static_cast<UINT>(pixels.size()), pixels.data(), &bitmap));
    double scale = std::min(1.0, 1280.0 / std::max(width, height));
    ComPtr<IWICBitmapScaler> scaler; check(factory->CreateBitmapScaler(&scaler));
    check(scaler->Initialize(bitmap.Get(), static_cast<UINT>(width * scale), static_cast<UINT>(height * scale), WICBitmapInterpolationModeFant));
    ComPtr<IStream> stream; check(CreateStreamOnHGlobal(nullptr, TRUE, &stream));
    ComPtr<IWICBitmapEncoder> encoder; check(factory->CreateEncoder(GUID_ContainerFormatJpeg, nullptr, &encoder));
    check(encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache));
    ComPtr<IWICBitmapFrameEncode> encoded; ComPtr<IPropertyBag2> options; check(encoder->CreateNewFrame(&encoded, &options));
    PROPBAG2 property{}; property.pstrName = const_cast<wchar_t*>(L"ImageQuality"); VARIANT quality{}; quality.vt = VT_R4; quality.fltVal = .55f;
    check(options->Write(1, &property, &quality)); check(encoded->Initialize(options.Get()));
    check(encoded->SetSize(static_cast<UINT>(width * scale), static_cast<UINT>(height * scale)));
    WICPixelFormatGUID format = GUID_WICPixelFormat24bppBGR; check(encoded->SetPixelFormat(&format));
    ComPtr<IWICFormatConverter> converter; check(factory->CreateFormatConverter(&converter));
    check(converter->Initialize(scaler.Get(), GUID_WICPixelFormat24bppBGR, WICBitmapDitherTypeNone, nullptr, 0, WICBitmapPaletteTypeCustom));
    check(encoded->WriteSource(converter.Get(), nullptr)); check(encoded->Commit()); check(encoder->Commit());
    STATSTG stats{}; check(stream->Stat(&stats, STATFLAG_NONAME)); require(stats.cbSize.QuadPart <= 1024 * 1024, "Screenshot exceeds image limit");
    LARGE_INTEGER start{}; check(stream->Seek(start, STREAM_SEEK_SET, nullptr));
    std::vector<unsigned char> jpeg(static_cast<size_t>(stats.cbSize.QuadPart)); ULONG read = 0;
    check(stream->Read(jpeg.data(), static_cast<ULONG>(jpeg.size()), &read)); require(read == jpeg.size(), "Incomplete screenshot"); return jpeg;
  }
