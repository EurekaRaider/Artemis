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
    panelTimer?.invalidate()
    panelTimer = nil
    panelStartedAt = nil
    panelApplicationPid = nil
    panel?.orderOut(nil)
    send(["event": "takeover", "reason": reason])
  }
  func updateControlTimer() {
    let elapsed = Int(max(0, ProcessInfo.processInfo.systemUptime - (panelStartedAt ?? ProcessInfo.processInfo.systemUptime)))
    panelTimerLabel?.stringValue = String(format: "%d:%02d", elapsed / 60, elapsed % 60)
  }
  func showControl(_ application: NSRunningApplication, stopLabel: String, darkAppearance _: Bool?) {
    if panel == nil {
      let panel = NSPanel(
        contentRect: CGRect(x: 0, y: 0, width: 390, height: 38),
        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
      panel.title = "Artemis · Computer Use"
      panel.isOpaque = false
      panel.backgroundColor = .clear
      panel.hasShadow = true
      panel.isMovableByWindowBackground = true
      panel.level = .floating
      panel.hidesOnDeactivate = false
      panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
      panel.appearance = NSAppearance(named: .darkAqua)
      let content = NSView(frame: CGRect(x: 0, y: 0, width: 390, height: 38))
      content.wantsLayer = true
      content.layer?.cornerRadius = 19
      content.layer?.masksToBounds = true
      content.layer?.backgroundColor = NSColor(srgbRed: 22 / 255, green: 23 / 255, blue: 27 / 255, alpha: 1).cgColor
      content.layer?.borderWidth = 0.5
      content.layer?.borderColor = NSColor.white.withAlphaComponent(0.08).cgColor
      panel.contentView = content
      let icon = NSImageView(frame: CGRect(x: 12, y: 11, width: 16, height: 16))
      icon.imageScaling = .scaleProportionallyDown
      icon.setAccessibilityElement(false)
      let label = NSTextField(labelWithString: "")
      label.frame = CGRect(x: 36, y: 11, width: 210, height: 16)
      label.font = .systemFont(ofSize: 12.5, weight: .medium)
      label.textColor = NSColor(srgbRed: 236 / 255, green: 237 / 255, blue: 239 / 255, alpha: 1)
      label.lineBreakMode = .byTruncatingTail
      let timer = NSTextField(labelWithString: "0:00")
      timer.frame = CGRect(x: 250, y: 11, width: 46, height: 16)
      timer.font = .monospacedDigitSystemFont(ofSize: 12, weight: .regular)
      timer.textColor = NSColor(srgbRed: 169 / 255, green: 173 / 255, blue: 182 / 255, alpha: 1)
      timer.alignment = .right
      let stop = NSButton(title: stopLabel, target: self, action: #selector(stopControl))
      stop.isBordered = false
      stop.wantsLayer = true
      stop.layer?.cornerRadius = 15
      stop.layer?.backgroundColor = NSColor(srgbRed: 242 / 255, green: 115 / 255, blue: 107 / 255, alpha: 1).cgColor
      stop.font = .systemFont(ofSize: 12.5, weight: .medium)
      stop.alignment = .center
      stop.frame = CGRect(x: 304, y: 4, width: 82, height: 30)
      content.addSubview(icon)
      content.addSubview(label)
      content.addSubview(timer)
      content.addSubview(stop)
      if let visible = NSScreen.main?.visibleFrame {
        panel.setFrameTopLeftPoint(CGPoint(x: visible.maxX - 406, y: visible.maxY - 16))
      }
      self.panel = panel
      panelLabel = label
      panelIcon = icon
      panelStop = stop
      panelTimerLabel = timer
    }
    if panel?.isVisible != true || panelApplicationPid != application.processIdentifier {
      panelStartedAt = ProcessInfo.processInfo.systemUptime
      panelApplicationPid = application.processIdentifier
    }
    updateControlTimer()
    if panelTimer == nil {
      panelTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
        MainActor.assumeIsolated { self?.updateControlTimer() }
      }
    }
    let name = application.localizedName ?? "Application"
    panelLabel?.stringValue = "Computer Use · \(name)"
    panelLabel?.toolTip = name
    panelIcon?.image = application.icon
    // Use a single centered title run. imageLeading reserves an asymmetric
    // image lane in NSButtonCell, shifting the icon/label group to the left.
    let title = NSMutableAttributedString(
      string: "■", attributes: [
        .font: NSFont.systemFont(ofSize: 10),
        .foregroundColor: NSColor(srgbRed: 26 / 255, green: 11 / 255, blue: 10 / 255, alpha: 1),
        .baselineOffset: 1,
      ])
    title.append(NSAttributedString(
      string: "  \(stopLabel)", attributes: [
        .font: NSFont.systemFont(ofSize: 12.5, weight: .medium),
        .foregroundColor: NSColor(srgbRed: 26 / 255, green: 11 / 255, blue: 10 / 255, alpha: 1),
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
