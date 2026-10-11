import NitroModules
import PoseCore
import QuartzCore
import Vision
import VisionCamera

/// Basic mode: Apple Vision body pose (`VNDetectHumanBodyPoseRequest`) mapped to the 17 COCO joints
/// by `VisionPoseMapper`. Needs no bundled model. Frames go through the same orientation path as
/// `HybridPoseDetector`, so Vision's normalized points are already upright and unmirrored.
final class HybridBasicPoseDetector: HybridPoseDetectorSpec {
  let model = VisionPoseMapper.model
  private let request = VNDetectHumanBodyPoseRequest()
  private let reader = PoseFrameReader()

  func setFrameOutput(output: any HybridCameraFrameOutputSpec) throws {
    reader.setFrameOutput(output)
  }

  func detect(frame: any HybridFrameSpec) throws -> PoseDetection {
    let f = try reader.read(frame)

    let start = CACurrentMediaTime()
    try VNImageRequestHandler(cvPixelBuffer: f.pixelBuffer, orientation: f.orientation).perform([request])
    let people = try (request.results ?? []).map { observation in
      try observation.recognizedPoints(.all).mapValues {
        VisionPoint(x: Float($0.location.x), y: Float($0.location.y), c: $0.confidence)
      }
    }
    let mapped = VisionPoseMapper.map(people: people, timestampMs: f.timestampMs)
    let latencyMs = (CACurrentMediaTime() - start) * 1000

    return PoseDetection(result: mapped.map(PoseFrameReader.toNitro), latencyMs: latencyMs)
  }
}
