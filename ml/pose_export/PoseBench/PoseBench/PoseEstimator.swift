import CoreML
import PoseCore
import QuartzCore
import Vision

/// Frame in, joints out. The seam for cloud offloading: a later `RemotePoseEstimator` (CONN-11)
/// conforms to this, and nothing above it changes.
protocol PoseEstimating: AnyObject {
    var modelName: String { get }
    /// `buffer` is upright and unmirrored (CameraFeed rotates at capture).
    func estimate(_ buffer: CVPixelBuffer, timestampMs: Int64) throws -> (result: PoseResult?, latencyMs: Double)
}

final class CoreMLPoseEstimator: PoseEstimating {
    let modelName: String
    private let inputSize: Int
    private let request: VNCoreMLRequest

    /// Throws `PoseError.modelMissing` when export.py hasn't been run, or Core ML's own load error.
    init(size: Int, bundle: Bundle = .main) throws {
        let url = try ModelLocator.url(size: size, in: bundle)
        let config = MLModelConfiguration()
        config.computeUnits = .all // lets Core ML use the Neural Engine
        let model = try VNCoreMLModel(for: MLModel(contentsOf: url, configuration: config))
        request = VNCoreMLRequest(model: model)
        request.imageCropAndScaleOption = .scaleFit // letterbox with centered padding; PoseDecoder undoes it
        inputSize = size
        modelName = ModelLocator.modelName(size: size)
    }

    func estimate(_ buffer: CVPixelBuffer, timestampMs: Int64) throws -> (result: PoseResult?, latencyMs: Double) {
        let start = CACurrentMediaTime()
        try VNImageRequestHandler(cvPixelBuffer: buffer, orientation: .up).perform([request])
        guard let observation = request.results?.first as? VNCoreMLFeatureValueObservation,
              let array = observation.featureValue.multiArrayValue else {
            throw PoseError.badOutput("model returned no multi-array output")
        }
        let floats = try MultiArrayReader.floats(array)
        let result = PoseDecoder.decode(output: floats, candidates: floats.count / 56, inputSize: inputSize,
                                        frameWidth: CVPixelBufferGetWidth(buffer),
                                        frameHeight: CVPixelBufferGetHeight(buffer),
                                        model: modelName, timestampMs: timestampMs)
        return (result, (CACurrentMediaTime() - start) * 1000)
    }
}
