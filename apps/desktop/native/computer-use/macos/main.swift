import AppKit

@main struct ComputerHelper {
  @MainActor static func main() {
    guard trustedParent() else { exit(77) }
    NSApplication.shared.setActivationPolicy(.accessory)
    let output = FileHandle.standardOutput
    let driver = Driver(output: output)
    Task { @MainActor in
      do {
        var buffer = Data()
        for try await byte in FileHandle.standardInput.bytes {
          if byte != 10 {
            guard buffer.count < 131072 else { exit(65) }
            buffer.append(byte)
            continue
          }
          let data = buffer
          buffer.removeAll(keepingCapacity: true)
          guard data.count <= 131072,
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
