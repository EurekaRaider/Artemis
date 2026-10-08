import AppKit
import ApplicationServices

@MainActor extension Driver {
  func app(_ bundle: String, launch: Bool = false) async throws -> NSRunningApplication {
    if let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first {
      return app
    }
    guard launch, let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle)
    else { throw Failure("Application is not running or installed: \(bundle)") }
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = false
    return try await NSWorkspace.shared.openApplication(at: url, configuration: configuration)
  }
  func target(_ bundle: String) throws -> [String: Any] {
    let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first
    guard
      let url = running?.bundleURL
        ?? NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle)
    else { throw Failure("Application bundle id was not found. Use computer_targets.") }
    let name = FileManager.default.displayName(atPath: url.path)
    return ["id": "desktop:\(bundle)", "kind": "desktop", "name": name, "bundleId": bundle]
  }
  func readyWindow(_ axApp: AXUIElement, application: NSRunningApplication, wait: Bool) async throws
    -> AXUIElement
  {
    let deadline = ProcessInfo.processInfo.systemUptime + (wait ? 3 : 0)
    while true {
      guard !application.isTerminated else {
        throw Failure("Application closed while opening its window.")
      }
      var value: CFTypeRef?
      let status = AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &value)
      if status == .success, let available = value as? [AXUIElement] {
        let focused = attribute(axApp, kAXFocusedWindowAttribute)
        if let window = available.first(where: { focused != nil && CFEqual($0, focused) })
          ?? available.first,
          let rectangle = bounds(window), rectangle.width > 0, rectangle.height > 0
        {
          return window
        }
      }
      guard wait, [.success, .cannotComplete, .noValue].contains(status),
        ProcessInfo.processInfo.systemUptime < deadline
      else {
        throw Failure(
          "Application window is not ready (AX status \(status.rawValue)). Retry after the window is available; do not use Shell or AppleScript to activate it."
        )
      }
      try await Task.sleep(nanoseconds: 75_000_000)
    }
  }
}
