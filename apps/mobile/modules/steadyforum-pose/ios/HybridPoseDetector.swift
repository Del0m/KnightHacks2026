import NitroModules
import QuartzCore
import VisionCamera

/// Runs YOLOv8n-pose on a Vision Camera frame via Vision/Core ML and decodes it with PoseCore.
/// Joints come back upright and unmirrored (anatomical left/right), normalized to the upright frame.
final class HybridPoseDetector: HybridPoseDetectorSpec {
  let model: String
  private let runner: PoseModelRunner
  private let reader = PoseFrameReader()

  /// Throws `PoseError.modelMissing` when the model is not in the app bundle, or Core ML's own load error.
  init(size: Int, bundle: Bundle = .main) throws {
    runner = try PoseModelRunner(size: size, bundle: bundle)
    model = runner.model
    super.init()
  }

  func setFrameOutput(output: any HybridCameraFrameOutputSpec) throws {
    reader.setFrameOutput(output)
  }

  func detect(frame: any HybridFrameSpec) throws -> PoseDetection {
    let f = try reader.read(frame)

    let start = CACurrentMediaTime()
    let decoded = try runner.run(f.pixelBuffer, orientation: f.orientation,
                                 uprightWidth: f.uprightWidth, uprightHeight: f.uprightHeight,
                                 timestampMs: f.timestampMs)
    let latencyMs = (CACurrentMediaTime() - start) * 1000

    return PoseDetection(result: decoded.map(PoseFrameReader.toNitro), latencyMs: latencyMs,
                         timestampMs: Double(f.timestampMs))
  }
}
