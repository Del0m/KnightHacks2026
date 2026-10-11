import CoreImage
import NitroModules
import PoseCore
import VisionCamera

/// Cloud mode: turns a Vision Camera frame into the upright JPEG the cloud pose relay expects.
/// Frames go through the same `PoseFrameReader` as the on-device detectors, so orientation and
/// capture time match them exactly. Never disposes the frame; the caller owns it.
final class HybridCloudFrameEncoder: HybridCloudFrameEncoderSpec {
  private let reader = PoseFrameReader()
  /// Reused for every frame; creating a context per frame is expensive.
  private let context = CIContext(options: [.cacheIntermediates: false])

  func setFrameOutput(output: any HybridCameraFrameOutputSpec) throws {
    reader.setFrameOutput(output)
  }

  func encode(frame: any HybridFrameSpec) throws -> CloudFrame {
    let f = try reader.read(frame)
    let encoded: EncodedCloudFrame
    do {
      encoded = try CloudFrameEncoder.encode(f.pixelBuffer, orientation: f.orientation, context: context)
    } catch PoseError.badOutput(let detail) {
      throw RuntimeError.error(withMessage: detail)
    }
    let jpeg = try ArrayBuffer.copy(data: encoded.jpeg)
    return CloudFrame(jpeg: jpeg, timestampMs: Double(f.timestampMs),
                      width: Double(encoded.width), height: Double(encoded.height))
  }
}
