import AppKit

if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--running-app-pids" {
  let pids = NSRunningApplication.runningApplications(
    withBundleIdentifier: CommandLine.arguments[2]
  ).map { $0.processIdentifier }.sorted()
  let data = try JSONSerialization.data(withJSONObject: pids)
  print(String(decoding: data, as: UTF8.self))
  exit(0)
}

final class Fixture: NSObject, NSApplicationDelegate {
  var window: NSWindow!
  let input = NSTextField(string: "")
  let output = NSTextField(labelWithString: "Ready")
  let password = NSSecureTextField(string: "PRIVATE_FIXTURE_VALUE")
  let spacer = NSView()
  var controls: [NSView] = []
  var expanded = false
  func applicationDidFinishLaunching(_ notification: Notification) {
    print("Synthetic app launching")
    fflush(stdout)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { self.showWindow() }
  }
  func showWindow() {
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
    let toggle = NSButton(
      title: "Toggle container", target: self, action: #selector(toggleContainer))
    toggle.frame = CGRect(x: 30, y: 40, width: 160, height: 32)
    password.frame = CGRect(x: 250, y: 44, width: 200, height: 26)
    password.setAccessibilityLabel("Password fixture")
    window.contentView?.addSubview(password)
    spacer.setAccessibilityElement(true)
    spacer.setAccessibilityRole(.group)
    window.contentView?.addSubview(input)
    window.contentView?.addSubview(button)
    window.contentView?.addSubview(output)
    window.contentView?.addSubview(toggle)
    controls = [input, button, output, toggle, password]
    window.contentView?.setAccessibilityChildren(controls)
    window.orderBack(nil)
    print(
      "Synthetic app ready: \(Bundle.main.bundleIdentifier ?? "unknown"), windows: \(NSApp.windows.count)"
    )
    fflush(stdout)
  }
  @objc func save() { output.stringValue = "Saved: \(input.stringValue)" }
  @objc func toggleContainer() {
    expanded.toggle()
    window.contentView?.setAccessibilityChildren(expanded ? [spacer] + controls : controls)
  }
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
let application = NSApplication.shared
let delegate = Fixture()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
