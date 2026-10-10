import CoreML
import CoreMedia
import NitroModules
import PoseCore
import QuartzCore
import Vision
import VisionCamera

/// Runs YOLOv8n-pose on a Vision Camera frame via Vision/Core ML and decodes it with PoseCore.
/// Joints come back upright and unmirrored (anatomical left/right), normalized to the upright frame.
final class HybridPoseDetector: HybridPoseDetectorSpec {
  let model: String
  private let inputSize: Int
  private let request: VNCoreMLRequest

  /// Same model setup as PoseBench's `CoreMLPoseEstimator`.
  /// Throws `PoseError.modelMissing` when the model is not in the app bundle, or Core ML's own load error.
  init(size: Int, bundle: Bundle = .main) throws {
    let url = try ModelLocator.url(size: size, in: bundle)
    let config = MLModelConfiguration()
    config.computeUnits = .all // lets Core ML use the Neural Engine
    let coreMLModel = try VNCoreMLModel(for: MLModel(contentsOf: url, configuration: config))
    request = VNCoreMLRequest(model: coreMLModel)
    request.imageCropAndScaleOption = .scaleFit // letterbox with centered padding; PoseDecoder undoes it
    inputSize = size
    model = ModelLocator.modelName(size: size)
    super.init()
  }

  func detect(frame: any HybridFrameSpec) throws -> PoseDetection {
    guard let nativeFrame = frame as? any NativeFrame else {
      throw RuntimeError.error(withMessage: "Frame is not a NativeFrame")
    }
    guard let sampleBuffer = nativeFrame.sampleBuffer,
          let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      throw RuntimeError.error(withMessage: "Frame has no pixel buffer; it may already be disposed")
    }

    let vision = ImageOrientation.vision(rotation: Self.rotation(frame.orientation),
                                         mirrored: frame.isMirrored,
                                         width: CVPixelBufferGetWidth(pixelBuffer),
                                         height: CVPixelBufferGetHeight(pixelBuffer))
    let timestampMs = Int64(Date().timeIntervalSince1970 * 1000)

    let start = CACurrentMediaTime()
    try VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: vision.orientation).perform([request])
    guard let observation = request.results?.first as? VNCoreMLFeatureValueObservation,
          let array = observation.featureValue.multiArrayValue else {
      throw PoseError.badOutput("model returned no multi-array output")
    }
    let floats = try MultiArrayReader.floats(array)
    let decoded = PoseDecoder.decode(output: floats, candidates: floats.count / 56, inputSize: inputSize,
                                     frameWidth: vision.uprightWidth, frameHeight: vision.uprightHeight,
                                     model: model, timestampMs: timestampMs)
    let latencyMs = (CACurrentMediaTime() - start) * 1000

    return PoseDetection(result: decoded.map(Self.toNitro), latencyMs: latencyMs)
  }

  /// Vision Camera's `orientation` is how the pixel data is rotated relative to upright,
  /// which is exactly what `FrameRotation` describes.
  private static func rotation(_ orientation: CameraOrientation) -> FrameRotation {
    switch orientation {
    case .up: return .up
    case .down: return .down
    case .left: return .left
    case .right: return .right
    }
  }

  private static func toNitro(_ r: PoseCore.PoseResult) -> PoseResult {
    PoseResult(source: r.source.rawValue,
               model: r.model,
               timestamp_ms: Double(r.timestampMs),
               score: Double(r.score),
               joints: r.joints.map { Joint(x: Double($0.x), y: Double($0.y), c: Double($0.c)) })
  }
}
