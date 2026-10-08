import AppKit
import CryptoKit
import ScreenCaptureKit
import Darwin

func processStart(_ pid: pid_t) -> Double? {
  var info = proc_bsdinfo()
  let size = MemoryLayout<proc_bsdinfo>.size
  let count = withUnsafeMutablePointer(to: &info) { proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, $0, Int32(size)) }
  guard count == size else { return nil }
  return Double(info.pbi_start_tvsec) * 1000 + Double(info.pbi_start_tvusec) / 1000
}

@MainActor func selectedCaptureWindow(application: NSRunningApplication, rectangle: CGRect) async throws -> SCWindow {
  let content = try await SCShareableContent.excludingDesktopWindows(
    true, onScreenWindowsOnly: false)
  let candidates = content.windows.filter({
      $0.owningApplication?.processID == application.processIdentifier
      && abs($0.frame.minX - rectangle.minX) < 8
      && abs($0.frame.minY - rectangle.minY) < 8
      && abs($0.frame.width - rectangle.width) < 8
      && abs($0.frame.height - rectangle.height) < 8
    })
  guard candidates.count == 1 else {
    let diagnostic = ProcessInfo.processInfo.environment["ARTEMIS_COMPUTER_DIAGNOSTICS"] == "1"
      ? " AX=\(rectangle), capture=\(content.windows.filter { $0.owningApplication?.processID == application.processIdentifier }.map { $0.frame })"
      : ""
    throw Failure("Unable to unambiguously identify the selected window for capture." + diagnostic)
  }
  return candidates[0]
}

@MainActor func captureWindowImage(application: NSRunningApplication, rectangle: CGRect, scale: CGFloat) async throws -> [String: Any] {
  let captureWindow = try await selectedCaptureWindow(application: application, rectangle: rectangle)
  let config = SCStreamConfiguration()
  config.width = Int(rectangle.width * scale)
  config.height = Int(rectangle.height * scale)
  config.showsCursor = false
  config.ignoreShadowsSingleWindow = true
  let image = try await SCScreenshotManager.captureImage(
    contentFilter: SCContentFilter(desktopIndependentWindow: captureWindow),
    configuration: config)
  let bitmap = NSBitmapImageRep(cgImage: image)
  guard let jpeg = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.6]),
    jpeg.count < 1_200_000
  else { throw Failure("Window screenshot exceeds the image budget.") }
  let imageResult: [String: Any] = ["data": jpeg.base64EncodedString(), "mimeType": "image/jpeg"]
  let visualRevision = SHA256.hash(data: jpeg).map { String(format: "%02x", $0) }.joined()
  return ["image": imageResult, "visualRevision": visualRevision]
}
