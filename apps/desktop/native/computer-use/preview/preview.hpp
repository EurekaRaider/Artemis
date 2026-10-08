#pragma once
#include <node_api.h>
#include <atomic>
#include <chrono>
#include <memory>
#include <string>
#include <stdexcept>

// Only Electron main loads this module. Handles never cross the public IPC API.
inline double previewNow() {
  return std::chrono::duration<double, std::milli>(std::chrono::system_clock::now().time_since_epoch()).count();
}
inline void napiCheck(napi_status status) {
  if (status != napi_ok) throw std::runtime_error("Native preview bridge failed");
}
inline napi_value property(napi_env env, napi_value object, const char* key) {
  napi_value value; napiCheck(napi_get_named_property(env, object, key, &value)); return value;
}
inline std::string textValue(napi_env env, napi_value object, const char* key) {
  size_t size; auto value = property(env, object, key);
  napiCheck(napi_get_value_string_utf8(env, value, nullptr, 0, &size));
  if (size > 1024) throw std::runtime_error("Invalid capture identity");
  std::string result(size + 1, '\0');
  napiCheck(napi_get_value_string_utf8(env, value, result.data(), result.size(), &size));
  result.resize(size); return result;
}
inline double numberValue(napi_env env, napi_value object, const char* key) {
  double result; napiCheck(napi_get_value_double(env, property(env, object, key), &result)); return result;
}
inline void putNumber(napi_env env, napi_value object, const char* key, double number) {
  napi_value value; napi_create_double(env, number, &value); napi_set_named_property(env, object, key, value);
}
inline void putText(napi_env env, napi_value object, const char* key, const std::string& text) {
  napi_value value; napi_create_string_utf8(env, text.data(), text.size(), &value); napi_set_named_property(env, object, key, value);
}
struct PreviewSession;
struct PreviewFrame {
  unsigned width = 0, height = 0;
  double capturedAt = previewNow();
  std::string error;
  std::weak_ptr<PreviewSession> owner;
  bool released = false;
  virtual ~PreviewFrame() = default;
  virtual void* handle() { return nullptr; }
  virtual const char* handleName() { return ""; }
  virtual void dispose() {}
  void release();
};
struct PreviewSession : std::enable_shared_from_this<PreviewSession> {
  std::atomic<bool> stopped{false};
  std::atomic<unsigned> outstanding{0};
  napi_threadsafe_function callback = nullptr;
  napi_deferred stopResult = nullptr;
  napi_async_cleanup_hook_handle cleanup = nullptr;
  bool finished = false;
  virtual ~PreviewSession() = default;
  virtual void stop() = 0;
  virtual void resize(unsigned maximum) = 0;
  void emit(PreviewFrame* frame) {
    if (stopped || napi_call_threadsafe_function(callback, frame, napi_tsfn_nonblocking) != napi_ok) {
      frame->release(); delete frame;
    }
  }
  void fail(const std::string& reason) {
    if (stopped) return;
    auto frame = new PreviewFrame(); frame->error = reason;
    if (napi_call_threadsafe_function(callback, frame, napi_tsfn_blocking) != napi_ok) delete frame;
    stop();
  }
};
inline void PreviewFrame::release() {
  if (released) return;
  released = true; dispose();
  if (auto session = owner.lock()) session->outstanding--;
}
inline napi_value releaseFrame(napi_env env, napi_callback_info info) {
  void* data; napi_get_cb_info(env, info, nullptr, nullptr, nullptr, &data);
  static_cast<PreviewFrame*>(data)->release(); return nullptr;
}
inline void deliverFrame(napi_env env, napi_value callback, void*, void* data) {
  auto frame = static_cast<PreviewFrame*>(data);
  if (!env || !callback) { frame->release(); delete frame; return; }
  napi_value object, release, undefined;
  napi_create_object(env, &object);
  if (!frame->error.empty()) putText(env, object, "error", frame->error);
  else {
    putNumber(env, object, "width", frame->width); putNumber(env, object, "height", frame->height);
    putNumber(env, object, "capturedAt", frame->capturedAt);
    void* handle = frame->handle(); napi_value buffer;
    napi_create_buffer_copy(env, sizeof(handle), &handle, nullptr, &buffer);
    napi_set_named_property(env, object, frame->handleName(), buffer);
  }
  napi_create_function(env, "release", NAPI_AUTO_LENGTH, releaseFrame, frame, &release);
  napi_set_named_property(env, object, "release", release);
  // The function owns the frame token even if callers retain only `release`.
  napi_add_finalizer(env, release, frame, [](napi_env, void* data, void*) {
    auto value = static_cast<PreviewFrame*>(data); value->release(); delete value;
  }, nullptr, nullptr);
  napi_get_undefined(env, &undefined);
  napi_call_function(env, undefined, callback, 1, &object, nullptr);
}
inline void initializeCallback(napi_env env, napi_value callback, std::shared_ptr<PreviewSession> session) {
  napi_value name; napi_create_string_utf8(env, "ArtemisWindowPreview", NAPI_AUTO_LENGTH, &name);
  auto lifetime = new std::shared_ptr<PreviewSession>(session);
  napiCheck(napi_create_threadsafe_function(env, callback, nullptr, name, 1, 1, lifetime,
    [](napi_env env, void* data, void*) {
      auto lifetime = static_cast<std::shared_ptr<PreviewSession>*>(data);
      auto session = *lifetime; session->finished = true;
      if (env && session->stopResult) { napi_value value; napi_get_undefined(env, &value); napi_resolve_deferred(env, session->stopResult, value); }
      if (session->cleanup) napi_remove_async_cleanup_hook(session->cleanup);
      delete lifetime;
    },
    nullptr, deliverFrame, &session->callback));
  napiCheck(napi_add_async_cleanup_hook(env, [](napi_async_cleanup_hook_handle, void* data) {
    (*static_cast<std::shared_ptr<PreviewSession>*>(data))->stop();
  }, lifetime, &session->cleanup));
  napi_unref_threadsafe_function(env, session->callback);
}
inline napi_value wrapSession(napi_env env, std::shared_ptr<PreviewSession> session) {
  napi_value object; napi_create_object(env, &object);
  auto lifetime = new std::shared_ptr<PreviewSession>(session);
  napi_wrap(env, object, lifetime, [](napi_env, void* data, void*) {
    auto value = static_cast<std::shared_ptr<PreviewSession>*>(data); (*value)->stop(); delete value;
  }, nullptr, nullptr);
  return object;
}
inline napi_value stopPreview(napi_env env, napi_callback_info info) {
  size_t count = 1; napi_value args[1]; void* data;
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  if (count != 1 || napi_unwrap(env, args[0], &data) != napi_ok) return nullptr;
  napi_value existing; napi_valuetype type;
  napi_get_named_property(env, args[0], "stopPromise", &existing); napi_typeof(env, existing, &type);
  if (type == napi_object) return existing;
  auto session = *static_cast<std::shared_ptr<PreviewSession>*>(data);
  napi_value promise; napi_deferred deferred; napi_create_promise(env, &deferred, &promise);
  napi_set_named_property(env, args[0], "stopPromise", promise);
  if (session->finished) { napi_value value; napi_get_undefined(env, &value); napi_resolve_deferred(env, deferred, value); }
  else session->stopResult = deferred;
  session->stop(); return promise;
}
inline napi_value resizePreview(napi_env env, napi_callback_info info) {
  try {
    size_t count = 2; napi_value args[2]; void* data;
    napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
    unsigned maximum;
    if (count != 2 || napi_unwrap(env, args[0], &data) != napi_ok || napi_get_value_uint32(env, args[1], &maximum) != napi_ok ||
        (maximum != 640 && maximum != 960 && maximum != 1280 && maximum != 1920)) throw std::runtime_error("Invalid preview size");
    (*static_cast<std::shared_ptr<PreviewSession>*>(data))->resize(maximum);
    return nullptr;
  } catch (const std::exception& error) { napi_throw_error(env, nullptr, error.what()); return nullptr; }
}
