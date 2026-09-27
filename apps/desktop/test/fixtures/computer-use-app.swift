import AppKit

final class Fixture: NSObject, NSApplicationDelegate {
  var window: NSWindow!
  let input = NSTextField(string: "")
  let output = NSTextField(labelWithString: "Ready")
  func applicationDidFinishLaunching(_ notification: Notification) {
    window = NSWindow(
      contentRect: CGRect(x: 140, y: 160, width: 500, height: 260),
      styleMask: [.titled, .closable], backing: .buffered, defer: false)
    window.title = "Artemis Computer Use fixture"
    input.frame = CGRect(x: 30, y: 180, width: 290, height: 30)
    input.setAccessibilityLabel("Name")
    output.frame = CGRect(x: 30, y: 100, width: 440, height: 30)
    let button = NSButton(title: "Save draft", target: self, action: #selector(save))
    button.frame = CGRect(x: 330, y: 180, width: 130, height: 32)
    button.bezelStyle = .rounded
    window.contentView?.addSubview(input)
    window.contentView?.addSubview(button)
    window.contentView?.addSubview(output)
    window.makeKeyAndOrderFront(nil)
    print(
      "Synthetic app ready: \(Bundle.main.bundleIdentifier ?? "unknown"), windows: \(NSApp.windows.count)"
    )
    fflush(stdout)
  }
  @objc func save() { output.stringValue = "Saved: \(input.stringValue)" }
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
let application = NSApplication.shared
let delegate = Fixture()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
