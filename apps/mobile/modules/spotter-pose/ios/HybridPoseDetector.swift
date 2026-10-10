import AVFoundation
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
  private weak var frameOutput: (any HybridCameraFrameOutputSpec)?
  private weak var calibratedConnection: AVCaptureConnection?
  private var calibratedOrientation: CameraOrientation?
  private let referenceOutput = AVCaptureVideoDataOutput()
  private var referenceConnection: AVCaptureConnection?

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
    frameOutput = output
  }

  func detect(frame: any HybridFrameSpec) throws -> PoseDetection {
    guard let nativeFrame = frame as? any NativeFrame else {
      throw RuntimeError.error(withMessage: "Frame is not a NativeFrame")
    }
    guard let sampleBuffer = nativeFrame.sampleBuffer,
          let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      throw RuntimeError.error(withMessage: "Frame has no pixel buffer; it may already be disposed")
    }

    guard let frameOutput, let output = frameOutput as? any NativeCameraOutput,
          let connection = output.output.connection(with: .video) else {
      throw RuntimeError.error(withMessage: "Pose detector has no active camera frame output")
    }
    if calibratedConnection !== connection || calibratedOrientation != frameOutput.outputOrientation
        || referenceConnection?.isVideoMirrored != connection.isVideoMirrored {
      let reference = AVCaptureConnection(inputPorts: connection.inputPorts, output: referenceOutput)
      guard reference.isVideoOrientationSupported else {
        throw RuntimeError.error(withMessage: "Camera does not support pose orientation calibration")
      }
      if reference.isVideoMirroringSupported {
        reference.automaticallyAdjustsVideoMirroring = false
        reference.isVideoMirrored = connection.isVideoMirrored
      }
      reference.videoOrientation = Self.captureOrientation(frameOutput.outputOrientation)
      referenceConnection = reference
      calibratedConnection = connection
      calibratedOrientation = frameOutput.outputOrientation
      print("Pose orientation: target \(reference.videoRotationAngle), buffer \(connection.videoRotationAngle), flag \(frame.orientation), mirrored \(frame.isMirrored)")
    }
    guard let referenceConnection else {
      throw RuntimeError.error(withMessage: "Pose orientation calibration is unavailable")
    }
    let vision = ImageOrientation.vision(captureRotationDegrees: Double(referenceConnection.videoRotationAngle),
                                         bufferRotationDegrees: Double(connection.videoRotationAngle),
                                         mirrored: frame.isMirrored,
                                         width: CVPixelBufferGetWidth(pixelBuffer),
                                         height: CVPixelBufferGetHeight(pixelBuffer))
    let timestampMs = try FrameTimestamp.unixMilliseconds(
      presentationSeconds: CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer)),
      hostSeconds: CMTimeGetSeconds(CMClockGetTime(CMClockGetHostTimeClock())),
      unixSeconds: Date().timeIntervalSince1970)

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

  private static func captureOrientation(_ orientation: CameraOrientation) -> AVCaptureVideoOrientation {
    switch orientation {
    case .up: return .portrait
    case .down: return .portraitUpsideDown
    case .left: return .landscapeRight
    case .right: return .landscapeLeft
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
