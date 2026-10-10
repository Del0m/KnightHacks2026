import CoreML
import CoreVideo
import ImageIO
import PoseCore
import Vision

/// One bundled YOLOv8n-pose model, loaded for Vision/Core ML and decoded with PoseCore.
/// Shared by the live detector and the synthetic-frame benchmark so both time the same work.
final class PoseModelRunner {
  let size: Int
  let model: String
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
    self.size = size
    model = ModelLocator.modelName(size: size)
  }

  /// Runs the model on `pixelBuffer` turned upright by `orientation`; `uprightWidth`/`uprightHeight`
  /// are the buffer's size after that turn. Returns nil when no person is found.
  func run(_ pixelBuffer: CVPixelBuffer, orientation: CGImagePropertyOrientation,
           uprightWidth: Int, uprightHeight: Int, timestampMs: Int64) throws -> PoseCore.PoseResult? {
    try VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: orientation).perform([request])
    guard let observation = request.results?.first as? VNCoreMLFeatureValueObservation,
          let array = observation.featureValue.multiArrayValue else {
      throw PoseError.badOutput("model returned no multi-array output")
    }
    let floats = try MultiArrayReader.floats(array)
    return PoseDecoder.decode(output: floats, candidates: floats.count / 56, inputSize: size,
                              frameWidth: uprightWidth, frameHeight: uprightHeight,
                              model: model, timestampMs: timestampMs)
  }
}
