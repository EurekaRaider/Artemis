#include "preview.hpp"
#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <IOSurface/IOSurface.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <mach/mach_time.h>
#include <libproc.h>

struct MacPreview;
@interface ArtemisPreviewOutput : NSObject<SCStreamOutput, SCStreamDelegate> {
@public std::weak_ptr<MacPreview> session;
}
@end
struct MacFrame : PreviewFrame {
  CMSampleBufferRef sample;
  IOSurfaceRef surface;
  MacFrame(CMSampleBufferRef value) : sample(value) {
    CFRetain(sample);
    auto pixels = CMSampleBufferGetImageBuffer(sample);
    surface = CVPixelBufferGetIOSurface(pixels);
    width = (unsigned)CVPixelBufferGetWidth(pixels); height = (unsigned)CVPixelBufferGetHeight(pixels);
  }
  void* handle() override { return surface; }
  const char* handleName() override { return "ioSurface"; }
  void dispose() override { CFRelease(sample); }
};
struct MacPreview : PreviewSession {
  pid_t pid; CGWindowID windowId; double processStart; std::string bundle;
  unsigned maximum;
  SCStream* stream = nil;
  ArtemisPreviewOutput* output = nil;
  SCStreamConfiguration* config = nil;
  dispatch_queue_t queue = dispatch_queue_create("com.artemis.preview.capture", DISPATCH_QUEUE_SERIAL);
  dispatch_source_t timer = nil;
  bool valid() {
    if (!CGPreflightScreenCaptureAccess()) return false;
    auto app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
    proc_bsdinfo process{};
    if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &process, sizeof(process)) != sizeof(process)) return false;
    double started = double(process.pbi_start_tvsec) * 1000 + double(process.pbi_start_tvusec) / 1000;
    if (!app || app.terminated || std::abs(started - processStart) > .01 ||
        bundle != (app.bundleIdentifier.UTF8String ?: "")) return false;
    NSArray* windows = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, windowId));
    for (NSDictionary* window in (NSArray*)windows)
      if ([window[(id)kCGWindowNumber] unsignedIntValue] == windowId &&
          [window[(id)kCGWindowOwnerPID] intValue] == pid) return true;
    return false;
  }
  void begin() {
    auto self = std::static_pointer_cast<MacPreview>(shared_from_this());
    [SCShareableContent getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:NO
      completionHandler:^(SCShareableContent* content, NSError* error) {
        dispatch_async(self->queue, ^{
          if (self->stopped) return;
          if (error || !self->valid()) { self->fail("Window capture permission or process identity changed"); return; }
          SCWindow* target = nil;
          for (SCWindow* window in content.windows)
            if (window.windowID == self->windowId && window.owningApplication.processID == self->pid)
              target = window;
          if (!target) { self->fail("Authorized window is unavailable"); return; }
          auto filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:target];
          auto config = [SCStreamConfiguration new]; self->config = config;
          double scale = std::min(1.0, self->maximum / std::max(target.frame.size.width, target.frame.size.height));
          config.width = std::max(1u, (unsigned)(target.frame.size.width * scale));
          config.height = std::max(1u, (unsigned)(target.frame.size.height * scale));
          config.minimumFrameInterval = CMTimeMake(1, 60); config.queueDepth = 5;
          config.pixelFormat = kCVPixelFormatType_32BGRA; config.colorSpaceName = kCGColorSpaceSRGB;
          config.showsCursor = NO; config.capturesAudio = NO; config.ignoreShadowsSingleWindow = YES;
          self->output = [ArtemisPreviewOutput new]; self->output->session = self;
          self->stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:self->output];
          NSError* registrationError = nil;
          if (![self->stream addStreamOutput:self->output type:SCStreamOutputTypeScreen
                sampleHandlerQueue:self->queue error:&registrationError]) {
            self->fail("Unable to register window capture output"); return;
          }
          [self->stream startCaptureWithCompletionHandler:^(NSError* startError) {
            if (startError && !self->stopped) self->fail(startError.localizedDescription.UTF8String);
          }];
          self->timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, self->queue);
          dispatch_source_set_timer(self->timer, dispatch_time(DISPATCH_TIME_NOW, 0), 100 * NSEC_PER_MSEC, 10 * NSEC_PER_MSEC);
          dispatch_source_set_event_handler(self->timer, ^{
            if (!self->stopped && !self->valid()) self->fail("Authorized window closed or capture permission changed");
            else if (!self->stopped) self->configure();
          });
          dispatch_resume(self->timer);
        });
      }];
  }
  void stop() override {
    if (stopped.exchange(true)) return;
    auto self = std::static_pointer_cast<MacPreview>(shared_from_this());
    dispatch_async(queue, ^{
      if (self->timer) { dispatch_source_cancel(self->timer); self->timer = nil; }
      if (self->stream) {
        [self->stream stopCaptureWithCompletionHandler:^(NSError*) {
          dispatch_async(self->queue, ^{
            [self->stream removeStreamOutput:self->output type:SCStreamOutputTypeScreen error:nil];
            self->stream = nil; self->output = nil; self->config = nil;
            napi_release_threadsafe_function(self->callback, napi_tsfn_release);
          });
        }];
      } else napi_release_threadsafe_function(self->callback, napi_tsfn_release);
    });
  }
  void configure() {
    if (!stream || !config) return;
    NSArray* windows = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, windowId));
    CGRect bounds;
    for (NSDictionary* window in windows) if ([window[(id)kCGWindowNumber] unsignedIntValue] == windowId &&
        CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)window[(id)kCGWindowBounds], &bounds)) {
      double scale = std::min(1.0, maximum / std::max(bounds.size.width, bounds.size.height));
      unsigned width = std::max(1u, (unsigned)(bounds.size.width * scale)), height = std::max(1u, (unsigned)(bounds.size.height * scale));
      if (config.width != width || config.height != height) {
        config.width = width; config.height = height;
        auto self = std::static_pointer_cast<MacPreview>(shared_from_this());
        [stream updateConfiguration:config completionHandler:^(NSError* error) {
          if (error && !self->stopped) self->fail("Unable to resize authorized window capture");
        }];
      }
      break;
    }
  }
  void resize(unsigned value) override {
    auto self = std::static_pointer_cast<MacPreview>(shared_from_this());
    dispatch_async(queue, ^{ if (!self->stopped) { self->maximum = value; self->configure(); } });
  }
};
@implementation ArtemisPreviewOutput
- (void)stream:(SCStream*)stream didOutputSampleBuffer:(CMSampleBufferRef)sample ofType:(SCStreamOutputType)type {
  auto capture = session.lock();
  if (!capture || capture->stopped || type != SCStreamOutputTypeScreen || !CMSampleBufferIsValid(sample)) return;
  NSArray* attachments = CFBridgingRelease(CMSampleBufferGetSampleAttachmentsArray(sample, NO) ?
    CFRetain(CMSampleBufferGetSampleAttachmentsArray(sample, NO)) : nullptr);
  NSInteger status = [attachments.firstObject[SCStreamFrameInfoStatus] integerValue];
  if (status == SCFrameStatusSuspended || status == SCFrameStatusBlank) {
    capture->fail(status == SCFrameStatusSuspended ? "Authorized window capture suspended" : "Authorized window capture is blank"); return;
  }
  if (status != SCFrameStatusComplete) return;
  if (capture->outstanding >= 3 || !CMSampleBufferGetImageBuffer(sample)) return;
  auto frame = new MacFrame(sample);
  NSNumber* displayed = attachments.firstObject[SCStreamFrameInfoDisplayTime];
  if (displayed) {
    mach_timebase_info_data_t timebase; mach_timebase_info(&timebase);
    double age = double(mach_absolute_time() - displayed.unsignedLongLongValue) * timebase.numer / timebase.denom / 1e6;
    frame->capturedAt = previewNow() - std::max(0.0, age);
  }
  if (!frame->surface) { frame->release(); delete frame; return; }
  capture->outstanding++; frame->owner = capture; capture->emit(frame);
}
- (void)stream:(SCStream*)stream didStopWithError:(NSError*)error {
  if (auto capture = session.lock()) if (!capture->stopped) capture->fail(error.localizedDescription.UTF8String);
}
@end
napi_value startPreview(napi_env env, napi_callback_info info) {
  try {
    size_t count = 3; napi_value args[3]; napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    if (count != 3) throw std::runtime_error("Missing authorized window identity");
    auto session = std::make_shared<MacPreview>();
    session->pid = (pid_t)numberValue(env, args[0], "pid");
    session->windowId = (CGWindowID)numberValue(env, args[0], "windowId");
    session->processStart = numberValue(env, args[0], "processStart");
    session->bundle = textValue(env, args[0], "appIdentity");
    unsigned maximum; napiCheck(napi_get_value_uint32(env, args[1], &maximum));
    if (session->pid <= 0 || !session->windowId || (maximum != 1280 && maximum != 1920) || !session->valid())
      throw std::runtime_error("Authorized window identity is no longer valid");
    session->maximum = maximum; initializeCallback(env, args[2], session);
    auto result = wrapSession(env, session); session->begin(); return result;
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
