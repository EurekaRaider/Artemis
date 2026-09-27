import AppKit
import ApplicationServices
import CryptoKit
import ScreenCaptureKit
import Security

struct Failure: Error, CustomStringConvertible {
  let description: String
  init(_ message: String) { description = message }
}
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
  var value: CFTypeRef?
  return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func bounds(_ element: AXUIElement) -> CGRect? {
  guard let position = attribute(element, kAXPositionAttribute),
    let size = attribute(element, kAXSizeAttribute),
    CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID()
  else { return nil }
  var point = CGPoint.zero
  var extent = CGSize.zero
  guard AXValueGetValue(position as! AXValue, .cgPoint, &point),
    AXValueGetValue(size as! AXValue, .cgSize, &extent)
  else { return nil }
  return CGRect(origin: point, size: extent)
}
func signingInfo(_ code: SecCode) -> NSDictionary? {
  var staticCode: SecStaticCode?
  guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else {
    return nil
  }
  var info: CFDictionary?
  guard
    SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info)
      == errSecSuccess
  else { return nil }
  return info
}
func trustedParent() -> Bool {
  guard getppid() > 1 else { return false }
  var parent: SecCode?
  var own: SecCode?
  guard
    SecCodeCopyGuestWithAttributes(
      nil, [kSecGuestAttributePid as String: getppid()] as CFDictionary, [], &parent)
      == errSecSuccess,
    SecCodeCopySelf([], &own) == errSecSuccess, let parent, let own
  else { return false }
  #if DEBUG
    // Development binary is never packaged. Still require Electron as the direct parent.
    return (signingInfo(parent)?[kSecCodeInfoIdentifier] as? String)?.contains("Electron") == true
  #else
    guard SecCodeCheckValidity(parent, [], nil) == errSecSuccess,
      SecCodeCheckValidity(own, [], nil) == errSecSuccess,
      let team = signingInfo(own)?[kSecCodeInfoTeamIdentifier] as? String,
      team == signingInfo(parent)?[kSecCodeInfoTeamIdentifier] as? String,
      let identifier = signingInfo(parent)?[kSecCodeInfoIdentifier] as? String
    else { return false }
    return identifier == "com.artemis.desktop"
  #endif
}

@MainActor final class Driver: NSObject {
  var elements: [String: AXUIElement] = [:]
  var nextElementId = 0
  var windowIdentity = UUID().uuidString
  var windows: [String: (AXUIElement, CGRect, CGFloat, pid_t)] = [:]
  var monitor: Any?
  var foregroundControl = false
  let output: FileHandle
  var panel: NSPanel?
  var panelLabel: NSTextField?
  var panelIcon: NSImageView?
  var panelStop: NSButton?
  var panelContent: NSView?
  init(output: FileHandle) {
    self.output = output
    super.init()
    monitor = NSEvent.addGlobalMonitorForEvents(matching: [
      .keyDown, .leftMouseDown, .rightMouseDown, .scrollWheel,
    ]) { [weak self] event in
      // Our CG events carry a marker; physical events pause before the next input.
      guard let self,
        event.cgEvent?.getIntegerValueField(.eventSourceUserData) != 0x4152_5445,
        shouldPauseComputerInput(
          recipient: self.inputRecipient(event),
          controlledPids: Set(self.windows.values.map { $0.3 }),
          foregroundControl: self.foregroundControl)
      else { return }
      self.pauseControl(
        self.foregroundControl
          ? "User input during foreground control"
          : event.type == .keyDown
            ? "User keyboard input in the target application"
            : "User pointer input in the target application")
    }
  }
  func inputRecipient(_ event: NSEvent) -> pid_t? {
    if event.type == .keyDown {
      return NSWorkspace.shared.frontmostApplication?.processIdentifier
    }
    guard let point = event.cgEvent?.location,
      let visible = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
    else { return nil }
    // The first window under the pointer receives the input. A background
    // target covered by another app must not claim that app's mouse events.
    for window in visible {
      guard let bounds = window[kCGWindowBounds as String] as? [String: Any],
        let rectangle = CGRect(dictionaryRepresentation: bounds as CFDictionary),
        rectangle.contains(point),
        (window[kCGWindowAlpha as String] as? Double ?? 1) > 0,
        let pid = window[kCGWindowOwnerPID as String] as? Int32
      else { continue }
      return pid
    }
    return nil
  }
  @objc func stopControl() {
    pauseControl("Native Stop button pressed")
  }
  func pauseControl(_ reason: String) {
    foregroundControl = false
    windows.removeAll()
    elements.removeAll()
    panel?.orderOut(nil)
    send(["event": "takeover", "reason": reason])
  }
  func showControl(_ application: NSRunningApplication, stopLabel: String, darkAppearance: Bool?) {
    if panel == nil {
      let panel = NSPanel(
        contentRect: CGRect(x: 0, y: 0, width: 340, height: 44),
        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
      panel.title = "Artemis · Computer Use"
      panel.isOpaque = false
      panel.backgroundColor = .clear
      panel.hasShadow = true
      panel.isMovableByWindowBackground = true
      panel.level = .floating
      panel.hidesOnDeactivate = false
      panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
      let content = NSView(frame: CGRect(x: 0, y: 0, width: 340, height: 44))
      // Match BrowserWindow(vibrancy: "sidebar", visualEffectState: "active").
      let glass = NSVisualEffectView(frame: content.bounds)
      glass.material = .sidebar
      glass.blendingMode = .behindWindow
      glass.state = .active
      glass.wantsLayer = true
      glass.layer?.cornerRadius = 12
      glass.layer?.masksToBounds = true
      glass.addSubview(content)
      panel.contentView = glass
      let icon = NSImageView(frame: CGRect(x: 12, y: 13, width: 18, height: 18))
      icon.imageScaling = .scaleProportionallyDown
      icon.setAccessibilityElement(false)
      let label = NSTextField(labelWithString: "")
      label.frame = CGRect(x: 38, y: 14, width: 204, height: 16)
      label.font = .systemFont(ofSize: 12, weight: .medium)
      label.textColor = .labelColor
      label.lineBreakMode = .byTruncatingTail
      let stop = NSButton(title: stopLabel, target: self, action: #selector(stopControl))
      stop.bezelStyle = .rounded
      stop.controlSize = .small
      stop.font = .systemFont(ofSize: 12, weight: .medium)
      stop.alignment = .center
      stop.frame = CGRect(x: 256, y: 9, width: 72, height: 26)
      content.addSubview(icon)
      content.addSubview(label)
      content.addSubview(stop)
      if let visible = NSScreen.main?.visibleFrame {
        panel.setFrameTopLeftPoint(CGPoint(x: visible.maxX - 356, y: visible.maxY - 16))
      }
      self.panel = panel
      panelContent = content
      panelLabel = label
      panelIcon = icon
      panelStop = stop
    }
    if let darkAppearance {
      panel?.appearance = NSAppearance(named: darkAppearance ? .darkAqua : .aqua)
    }
    let dark = panel?.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
    // Same tint as --sidebar-native-color / --sidebar-native-tint in the renderer.
    panelContent?.wantsLayer = true
    panelContent?.layer?.backgroundColor = (dark
      ? NSColor(srgbRed: 29 / 255, green: 29 / 255, blue: 29 / 255, alpha: 0.12)
      : NSColor.white.withAlphaComponent(0.8)).cgColor
    let name = application.localizedName ?? "Application"
    panelLabel?.stringValue = "Computer Use · \(name)"
    panelLabel?.toolTip = name
    panelIcon?.image = application.icon
    // Use a single centered title run. imageLeading reserves an asymmetric
    // image lane in NSButtonCell, shifting the icon/label group to the left.
    let title = NSMutableAttributedString(
      string: "■", attributes: [
        .font: NSFont.systemFont(ofSize: 10),
        .foregroundColor: NSColor.systemRed.withAlphaComponent(0.8),
        .baselineOffset: 1,
      ])
    title.append(NSAttributedString(
      string: "  \(stopLabel)", attributes: [
        .font: NSFont.systemFont(ofSize: 12, weight: .medium),
        .foregroundColor: NSColor.labelColor,
      ]))
    panelStop?.attributedTitle = title
    panelStop?.setAccessibilityLabel(stopLabel)
    if panel?.isVisible != true { panel?.orderFrontRegardless() }
  }
  func send(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) {
      output.write(data)
      output.write(Data([10]))
    }
  }
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
  func handle(_ request: [String: Any]) async throws -> Any {
    guard let method = request["method"] as? String else { throw Failure("Missing method") }
    let args = request["args"] as? [String: Any] ?? [:]
    switch method {
    case "status":
      return [
        "accessibility": AXIsProcessTrusted(), "screenRecording": CGPreflightScreenCaptureAccess(),
      ]
    case "permissions":
      let prompt =
        [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
      return [
        "accessibility": AXIsProcessTrustedWithOptions(prompt),
        "screenRecording": CGRequestScreenCaptureAccess(),
      ]
    case "targets":
      return NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
        .compactMap { application -> [String: Any]? in
          guard let bundle = application.bundleIdentifier else { return nil }
          return try? target(bundle)
        }
    case "open":
      guard let targetName = args["target"] as? String else { throw Failure("Missing target") }
      let bundle = targetName.hasPrefix("desktop:") ? String(targetName.dropFirst(8)) : targetName
      return try target(bundle)
    case "release":
      if let id = args["id"] as? String { windows.removeValue(forKey: id) }
      elements.removeAll()
      foregroundControl = false
      panel?.orderOut(nil)
      return ["released": true]
    case "observe": return try await observe(args)
    case "act":
      try await act(args)
      return ["completed": true]
    default: throw Failure("Unknown method")
    }
  }
  func observe(_ args: [String: Any]) async throws -> [String: Any] {
    guard AXIsProcessTrusted(), CGPreflightScreenCaptureAccess() else {
      throw Failure(
        "Enable Accessibility and Screen Recording for Artemis in macOS System Settings, then retry."
      )
    }
    guard let id = args["id"] as? String, id.hasPrefix("desktop:") else {
      throw Failure("Invalid target")
    }
    let application = try await app(String(id.dropFirst(8)), launch: true)
    let axApp = AXUIElementCreateApplication(application.processIdentifier)
    AXUIElementSetMessagingTimeout(axApp, 0.5)
    let window = try await readyWindow(axApp, application: application, wait: windows[id] == nil)
    guard let rectangle = bounds(window), rectangle.width > 0, rectangle.height > 0 else {
      throw Failure(
        "Application window has no accessible geometry. Open a visible window and retry.")
    }
    let scale = min(1, 1280 / max(rectangle.width, rectangle.height))
    let sameWindow = windows[id].map { CFEqual($0.0, window) } ?? false
    if !sameWindow { windowIdentity = UUID().uuidString }
    let previousElements = sameWindow ? elements : [:]
    windows[id] = (window, rectangle, scale, application.processIdentifier)
    showControl(
      application, stopLabel: args["stopLabel"] as? String ?? "Stop",
      darkAppearance: args["darkAppearance"] as? Bool)
    elements.removeAll()
    var nodes: [[String: Any]] = []
    var modalElements: [AXUIElement] = []
    var queue: [(AXUIElement, Int)] = [(window, 0)]
    var count = 0
    while !queue.isEmpty && nodes.count < 250 && count < 1000 {
      let (element, depth) = queue.removeFirst()
      count += 1
      let role = attribute(element, kAXRoleAttribute) as? String ?? ""
      let subrole = attribute(element, kAXSubroleAttribute) as? String ?? ""
      if role == kAXSheetRole || subrole == kAXDialogSubrole || subrole == kAXSystemDialogSubrole {
        modalElements.append(element)
      }
      if subrole == kAXSecureTextFieldSubrole { continue }
      let value = attribute(element, kAXValueAttribute) as? String
      let label =
        (attribute(element, kAXTitleAttribute) as? String)
        ?? (attribute(element, kAXDescriptionAttribute) as? String)
        ?? (role == kAXStaticTextRole ? value : nil) ?? ""
      if !label.isEmpty
        || [
          kAXButtonRole, kAXTextFieldRole, kAXTextAreaRole, kAXCheckBoxRole, kAXPopUpButtonRole,
          kAXMenuItemRole,
        ].contains(role)
      {
        // AX trees contain transient, unlabelled containers. Traversal offsets
        // are not element identities; retain handles only for the same AX object.
        let elementId: String
        if let existing = previousElements.first(where: { CFEqual($0.value, element) }) {
          elementId = existing.key
        } else {
          nextElementId += 1
          elementId = "ax:\(nextElementId)"
        }
        elements[elementId] = element
        var node: [String: Any] = [
          "id": elementId, "role": role, "label": String(label.prefix(500)),
        ]
        if let value {
          node["value"] = String(value.prefix(2000))
          node["valueDigest"] = SHA256.hash(data: Data(value.utf8)).map {
            String(format: "%02x", $0)
          }.joined()
        }
        if let box = bounds(element) {
          node["bounds"] = [
            "x": (box.minX - rectangle.minX) * scale, "y": (box.minY - rectangle.minY) * scale,
            "width": box.width * scale, "height": box.height * scale,
          ]
        }
        nodes.append(node)
      }
      if depth < 12, let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
        queue += children.prefix(250).map { ($0, depth + 1) }
      }
    }
    let revisionNodes = nodes.sorted { ($0["id"] as! String) < ($1["id"] as! String) }.map {
      node -> [String: Any] in
      var value = node
      value.removeValue(forKey: "value")
      value.removeValue(forKey: "valueDigest")
      return value
    }
    let identity: [String: Any] = [
      "pid": application.processIdentifier,
      "window": attribute(window, kAXTitleAttribute) as? String ?? "",
      "bounds": [rectangle.minX, rectangle.minY, rectangle.width, rectangle.height],
      "nodes": revisionNodes,
    ]
    let revision = SHA256.hash(
      data: try JSONSerialization.data(withJSONObject: identity, options: [.sortedKeys])
    ).map { String(format: "%02x", $0) }.joined()
    let scope: [String: Any] = [
      "window": windowIdentity,
      "pid": application.processIdentifier,
      "title": attribute(window, kAXTitleAttribute) as? String ?? "",
      "bounds": [rectangle.minX, rectangle.minY, rectangle.width, rectangle.height],
      "modals": modalElements.map { CFHash($0) }.sorted(),
    ]
    let scopeRevision = SHA256.hash(
      data: try JSONSerialization.data(withJSONObject: scope, options: [.sortedKeys])
    ).map { String(format: "%02x", $0) }.joined()
    var result: [String: Any] = [
      "revision": revision, "scopeRevision": scopeRevision, "width": Int(rectangle.width * scale),
      "height": Int(rectangle.height * scale), "elements": nodes,
      "foreground": application.isActive,
    ]
    if args["image"] as? Bool == true {
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
      result["image"] = ["data": jpeg.base64EncodedString(), "mimeType": "image/jpeg"]
      result["visualRevision"] = SHA256.hash(data: jpeg).map { String(format: "%02x", $0) }.joined()
    }
    return result
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
  func post(_ event: CGEvent, pid: pid_t) {
    event.setIntegerValueField(.eventSourceUserData, value: 0x4152_5445)
    event.postToPid(pid)
  }
  func act(_ args: [String: Any]) async throws {
    guard AXIsProcessTrusted(), let id = args["id"] as? String,
      let (window, rectangle, scale, pid) = windows[id],
      bounds(window) == rectangle, let action = args["action"] as? [String: Any],
      let type = action["type"] as? String
    else { throw Failure("Target changed or access was revoked. Observe again.") }
    if type == "click" || type == "fill" {
      guard let elementId = action["elementId"] as? String, let element = elements[elementId] else {
        throw Failure("Element is stale.")
      }
      if type == "fill" {
        guard let text = action["text"] as? String, text.count <= 16000,
          (attribute(element, kAXSubroleAttribute) as? String) != kAXSecureTextFieldSubrole
        else { throw Failure("Cannot fill this field.") }
        guard
          AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, text as CFString)
            == .success
        else {
          throw Failure(
            "foreground-required: This field does not support background AX editing. Do not use Shell to bypass foreground permission."
          )
        }
      } else if AXUIElementPerformAction(element, kAXPressAction as CFString) != .success {
        throw Failure(
          "foreground-required: This control does not support background AX press. Coordinate input requires separate user foreground permission; do not use Shell to bypass it."
        )
      }
      return
    }
    guard let application = NSRunningApplication(processIdentifier: pid) else {
      throw Failure("Application closed.")
    }
    guard args["allowForeground"] as? Bool == true else {
      throw Failure(
        "foreground-required: Keep background control until the user explicitly allows foreground input. Do not activate the app through Shell."
      )
    }
    foregroundControl = true
    application.activate(options: [])
    let deadline = ProcessInfo.processInfo.systemUptime + 1
    while !application.isActive && ProcessInfo.processInfo.systemUptime < deadline {
      try await Task.sleep(nanoseconds: 20_000_000)
    }
    guard windows[id] != nil else {
      throw Failure("Computer Use paused by user input. Wait for Resume.")
    }
    guard application.isActive else {
      throw Failure("Bring this application to the foreground, then retry.")
    }
    if type == "click_at" {
      guard let x = action["x"] as? Double, let y = action["y"] as? Double, x >= 0, y >= 0,
        x < rectangle.width * scale, y < rectangle.height * scale
      else { throw Failure("Coordinates are outside this window.") }
      let point = CGPoint(x: rectangle.minX + x / scale, y: rectangle.minY + y / scale)
      if let down = CGEvent(
        mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point,
        mouseButton: .left),
        let up = CGEvent(
          mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point,
          mouseButton: .left)
      {
        post(down, pid: pid)
        post(up, pid: pid)
      }
    } else if type == "key" {
      let keys: [String: CGKeyCode] = [
        "Enter": 36, "Tab": 48, "Escape": 53, "Backspace": 51, "ArrowUp": 126, "ArrowDown": 125,
        "ArrowLeft": 123, "ArrowRight": 124, "Space": 49,
      ]
      guard let name = action["key"] as? String, let code = keys[name] else {
        throw Failure("Unsupported key")
      }
      var flags: CGEventFlags = []
      for modifier in action["modifiers"] as? [String] ?? [] {
        switch modifier {
        case "Meta": flags.insert(.maskCommand)
        case "Control": flags.insert(.maskControl)
        case "Alt": flags.insert(.maskAlternate)
        case "Shift": flags.insert(.maskShift)
        default: throw Failure("Unsupported modifier")
        }
      }
      for pressed in [true, false] {
        if let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: pressed) {
          event.flags = flags
          post(event, pid: pid)
        }
      }
    } else if type == "scroll" {
      guard let direction = action["direction"] as? String, let amount = action["amount"] as? Int32,
        amount > 0, amount <= 1000
      else { throw Failure("Invalid scroll") }
      let delta = ["up", "left"].contains(direction) ? amount : -amount
      if let event = CGEvent(
        scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2,
        wheel1: ["up", "down"].contains(direction) ? delta : 0,
        wheel2: ["left", "right"].contains(direction) ? delta : 0, wheel3: 0)
      {
        post(event, pid: pid)
      }
    } else {
      throw Failure("Unsupported action")
    }
  }
}

@main struct ComputerHelper {
  @MainActor static func main() {
    guard trustedParent() else { exit(77) }
    NSApplication.shared.setActivationPolicy(.accessory)
    let output = FileHandle(fileDescriptor: 4, closeOnDealloc: true)
    let driver = Driver(output: output)
    Task { @MainActor in
      do {
        for try await line in FileHandle(fileDescriptor: 3, closeOnDealloc: true).bytes.lines {
          guard line.utf8.count <= 131072, let data = line.data(using: .utf8),
            let request = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let id = request["id"] as? String
          else { exit(65) }
          do { driver.send(["id": id, "result": try await driver.handle(request)]) } catch {
            driver.send(["id": id, "error": String(describing: error)])
          }
        }
      } catch { exit(74) }
      NSApplication.shared.terminate(nil)
    }
    // AppKit must own the event loop for AX replies, takeover and the Stop panel.
    NSApplication.shared.run()
  }
}
