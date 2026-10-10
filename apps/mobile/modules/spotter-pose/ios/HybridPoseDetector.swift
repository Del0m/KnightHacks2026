import CoreML
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
  private let reader = PoseFrameReader()

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

  func setFrameOutput(output: any HybridCameraFrameOutputSpec) throws {
    reader.setFrameOutput(output)
  }

  func detect(frame: any HybridFrameSpec) throws -> PoseDetection {
    let f = try reader.read(frame)

    let start = CACurrentMediaTime()
    try VNImageRequestHandler(cvPixelBuffer: f.pixelBuffer, orientation: f.orientation).perform([request])
    guard let observation = request.results?.first as? VNCoreMLFeatureValueObservation,
          let array = observation.featureValue.multiArrayValue else {
      throw PoseError.badOutput("model returned no multi-array output")
    }
    let floats = try MultiArrayReader.floats(array)
    let decoded = PoseDecoder.decode(output: floats, candidates: floats.count / 56, inputSize: inputSize,
                                     frameWidth: f.uprightWidth, frameHeight: f.uprightHeight,
                                     model: model, timestampMs: f.timestampMs)
    let latencyMs = (CACurrentMediaTime() - start) * 1000

    return PoseDetection(result: decoded.map(PoseFrameReader.toNitro), latencyMs: latencyMs)
  }
}
