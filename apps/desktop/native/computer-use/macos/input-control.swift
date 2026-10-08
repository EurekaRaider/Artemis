import AppKit
import ApplicationServices

@MainActor extension Driver {
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
  func post(_ event: CGEvent, pid: pid_t) {
    event.setIntegerValueField(.eventSourceUserData, value: 0x4152_5445)
    event.postToPid(pid)
  }
}
