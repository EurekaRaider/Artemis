import AppKit
import ApplicationServices

@MainActor final class Driver: NSObject {
  var elements: [String: AXUIElement] = [:]
  var nextElementId = 0
  var windowIdentity = UUID().uuidString
  var windows: [String: (AXUIElement, CGRect, CGFloat, pid_t)] = [:]
  var monitor: Any?
  var foregroundControl = false
  let diagnostics = ProcessInfo.processInfo.environment["ARTEMIS_COMPUTER_DIAGNOSTICS"] == "1"
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
      guard let self else { return }
      let tagged = event.cgEvent?.getIntegerValueField(.eventSourceUserData) == 0x4152_5445
      if tagged && !self.diagnostics { return }
      let recipient = self.inputRecipient(event)
      let pauses = !tagged && shouldPauseComputerInput(
        recipient: recipient, controlledPids: Set(self.windows.values.map { $0.3 }),
        foregroundControl: self.foregroundControl)
      if self.diagnostics && !self.windows.isEmpty {
        self.send(["event": "input-diagnostic", "type": event.type.rawValue,
          "sourcePid": event.cgEvent?.getIntegerValueField(.eventSourceUnixProcessID) ?? -1,
          "recipientPid": recipient ?? -1, "controlledPids": self.windows.values.map { $0.3 },
          "tagged": tagged, "eventTime": event.timestamp,
          "receivedTime": ProcessInfo.processInfo.systemUptime,
          "foreground": self.foregroundControl, "session": self.windowIdentity, "pauses": pauses])
      }
      guard pauses else { return }
      self.pauseControl(
        self.foregroundControl
          ? "User input during foreground control"
          : event.type == .keyDown
            ? "User keyboard input in the target application"
            : "User pointer input in the target application")
    }
  }
  func send(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) {
      if data.count > 2 * 1024 * 1024 {
        if let id = value["id"] as? String,
          let error = try? JSONSerialization.data(withJSONObject: ["id": id, "error": "Native response exceeds the frame budget"]) {
          output.write(error)
          output.write(Data([10]))
        }
        return
      }
      output.write(data)
      output.write(Data([10]))
    }
  }
  func handle(_ request: [String: Any]) async throws -> Any {
    guard let method = request["method"] as? String else { throw Failure("Missing method") }
    let args = request["args"] as? [String: Any] ?? [:]
    switch method {
    case "hello":
      return ["helperProtocol": 1, "platform": "darwin", "previewIdentity": 1]
    case "status":
      return [
        "platform": "darwin", "helperProtocol": 1,
        "accessibility": AXIsProcessTrusted(), "screenRecording": CGPreflightScreenCaptureAccess(),
        "automationReady": AXIsProcessTrusted(), "captureReady": CGPreflightScreenCaptureAccess(),
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
    case "preview-identity":
      guard AXIsProcessTrusted(), CGPreflightScreenCaptureAccess(),
        let id = args["id"] as? String, let (window, _, _, pid) = windows[id],
        let application = NSRunningApplication(processIdentifier: pid),
        let rectangle = bounds(window), let start = processStart(pid),
        application.bundleIdentifier == String(id.dropFirst(8))
      else { throw Failure("Authorized window is no longer available") }
      let selected = try await selectedCaptureWindow(application: application, rectangle: rectangle)
      return ["version": 1, "targetId": id, "pid": pid, "windowId": selected.windowID,
        "processStart": start,
        "appIdentity": application.bundleIdentifier!, "platform": "darwin"]
    case "observe": return try await observe(args)
    case "act":
      try await act(args)
      return ["completed": true]
    default: throw Failure("Unknown method")
    }
  }
}
