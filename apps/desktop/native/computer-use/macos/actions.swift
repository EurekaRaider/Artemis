import AppKit
import ApplicationServices

@MainActor extension Driver {
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
