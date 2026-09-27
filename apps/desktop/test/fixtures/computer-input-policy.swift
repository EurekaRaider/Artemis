import Foundation

@main struct ComputerInputPolicyTests {
  static func main() {
    let target: Int32 = 101
    precondition(
      !shouldPauseComputerInput(recipient: 202, controlledPids: [target], foregroundControl: false),
      "Typing/clicking/scrolling in another app must not pause background control")
    precondition(
      !shouldPauseComputerInput(recipient: nil, controlledPids: [target], foregroundControl: false),
      "An unrelated global shortcut is not target input")
    precondition(
      shouldPauseComputerInput(
        recipient: target, controlledPids: [target], foregroundControl: false),
      "Input addressed to the controlled app must pause")
    precondition(
      shouldPauseComputerInput(recipient: 202, controlledPids: [target], foregroundControl: true),
      "Foreground control must yield to user input anywhere")
    precondition(
      !shouldPauseComputerInput(recipient: target, controlledPids: [], foregroundControl: true),
      "Released control must ignore input")
    print("Computer Use input policy: 5 checks passed")
  }
}
