import AVFoundation
import CoreMedia
import ImageIO
import NitroModules
import PoseCore
import VisionCamera

/// One Vision Camera frame, ready for a Vision request: the buffer, the orientation that makes it
/// upright and unmirrored, its upright size, and its capture time in Unix milliseconds.
struct PoseFrame {
  let pixelBuffer: CVPixelBuffer
  let orientation: CGImagePropertyOrientation
  let uprightWidth: Int
  let uprightHeight: Int
  let timestampMs: Int64
}

/// Shared by the Core ML and Apple Vision detectors, so both see frames the same way.
final class PoseFrameReader {
  private weak var frameOutput: (any HybridCameraFrameOutputSpec)?
  private weak var calibratedConnection: AVCaptureConnection?
  private var calibratedOrientation: CameraOrientation?
  private let referenceOutput = AVCaptureVideoDataOutput()
  private var referenceConnection: AVCaptureConnection?

  func setFrameOutput(_ output: any HybridCameraFrameOutputSpec) {
    frameOutput = output
  }

  func read(_ frame: any HybridFrameSpec) throws -> PoseFrame {
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

    return PoseFrame(pixelBuffer: pixelBuffer, orientation: vision.orientation,
                     uprightWidth: vision.uprightWidth, uprightHeight: vision.uprightHeight,
                     timestampMs: timestampMs)
  }

  private static func captureOrientation(_ orientation: CameraOrientation) -> AVCaptureVideoOrientation {
    switch orientation {
    case .up: return .portrait
    case .down: return .portraitUpsideDown
    case .left: return .landscapeRight
    case .right: return .landscapeLeft
    }
  }

  static func toNitro(_ r: PoseCore.PoseResult) -> PoseResult {
    PoseResult(source: r.source.rawValue,
               model: r.model,
               timestamp_ms: Double(r.timestampMs),
               score: Double(r.score),
               joints: r.joints.map { Joint(x: Double($0.x), y: Double($0.y), c: Double($0.c)) })
  }
}
