import NitroModules

/// Entry point registered with Nitro; JS calls `createPoseDetector(size)` or `createBasicPoseDetector()` on it.
class HybridPoseDetectorFactory: HybridPoseDetectorFactorySpec {
  func createPoseDetector(size: Double) throws -> any HybridPoseDetectorSpec {
    guard size == 320 || size == 256 else {
      throw RuntimeError.error(withMessage: "unsupported size \(Self.format(size)); use 320 or 256")
    }
    return try HybridPoseDetector(size: Int(size))
  }

  func createBasicPoseDetector() throws -> any HybridPoseDetectorSpec {
    HybridBasicPoseDetector()
  }

  /// Prints whole numbers without a trailing ".0" so the message reads `unsupported size 300`.
  private static func format(_ size: Double) -> String {
    if size.isFinite, size == size.rounded(), abs(size) < 1e15 {
      return String(Int64(size))
    }
    return String(size)
  }
}
