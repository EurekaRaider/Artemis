import AppKit
import CryptoKit
import ScreenCaptureKit

@MainActor func captureWindowImage(application: NSRunningApplication, rectangle: CGRect, scale: CGFloat) async throws -> [String: Any] {
  let content = try await SCShareableContent.excludingDesktopWindows(
    true, onScreenWindowsOnly: false)
  guard
    let captureWindow = content.windows.filter({
      $0.owningApplication?.processID == application.processIdentifier
    }).min(by: {
      abs($0.frame.minX - rectangle.minX) + abs($0.frame.minY - rectangle.minY)
        + abs($0.frame.width - rectangle.width) < abs($1.frame.minX - rectangle.minX)
        + abs($1.frame.minY - rectangle.minY) + abs($1.frame.width - rectangle.width)
    }), abs(captureWindow.frame.minX - rectangle.minX) < 8,
    abs(captureWindow.frame.minY - rectangle.minY) < 8,
    abs(captureWindow.frame.width - rectangle.width) < 8,
    abs(captureWindow.frame.height - rectangle.height) < 8
  else { throw Failure("Unable to identify the selected window for capture.") }
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
