import AppKit
import ApplicationServices
import CryptoKit

@MainActor extension Driver {
  func observe(_ args: [String: Any]) async throws -> [String: Any] {
    guard AXIsProcessTrusted(), CGPreflightScreenCaptureAccess() else {
      throw Failure(
        "Enable Accessibility and Screen Recording for Artemis Computer Use in macOS System Settings, then retry."
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
      result.merge(try await captureWindowImage(application: application, rectangle: rectangle, scale: scale)) { _, next in next }
    }
    return result
  }
}
