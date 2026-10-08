import AppKit
import ApplicationServices
import Security
import Darwin

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
  var input = stat()
  var output = stat()
  guard fstat(STDIN_FILENO, &input) == 0, fstat(STDOUT_FILENO, &output) == 0,
    [S_IFIFO, S_IFSOCK].contains(input.st_mode & S_IFMT),
    [S_IFIFO, S_IFSOCK].contains(output.st_mode & S_IFMT),
    getppid() > 1
  else { return false }
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
