import Foundation

func shouldPauseComputerInput(
  recipient: Int32?, controlledPids: Set<Int32>, foregroundControl: Bool
) -> Bool {
  guard !controlledPids.isEmpty else { return false }
  if foregroundControl { return true }
  return recipient.map { controlledPids.contains($0) } ?? false
}
