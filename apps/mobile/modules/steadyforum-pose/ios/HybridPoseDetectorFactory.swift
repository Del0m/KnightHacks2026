import CoreML
import CoreVideo
import NitroModules
import PoseCore
import QuartzCore

/// Entry point registered with Nitro: creates the detectors and the cloud frame encoder, and runs the on-device benchmark (AI-04).
class HybridPoseDetectorFactory: HybridPoseDetectorFactorySpec {
  private static let sizes = [320, 256]
  /// Serial, so two benchmarks never compete for the Neural Engine.
  private static let benchmarkQueue = DispatchQueue(label: "steadyforum-pose.benchmark", qos: .userInitiated)

  func createPoseDetector(size: Double) throws -> any HybridPoseDetectorSpec {
    try Self.validate(size)
    return try HybridPoseDetector(size: Int(size))
  }

  func createBasicPoseDetector() throws -> any HybridPoseDetectorSpec {
    HybridBasicPoseDetector()
  }

  func createCloudFrameEncoder() throws -> any HybridCloudFrameEncoderSpec {
    HybridCloudFrameEncoder()
  }

  func poseModelId() throws -> String {
    Self.modelId
  }

  func benchmarkPoseModel(size: Double, warmUpMs: Double, measureMs: Double) throws -> Promise<PoseBenchmark> {
    do {
      try Self.validate(size)
    } catch {
      return Promise.rejected(withError: error)
    }
    let intSize = Int(size)
    let warmUp = warmUpMs.isFinite ? max(warmUpMs, 0) / 1000 : 0
    let measure = measureMs.isFinite ? max(measureMs, 0) / 1000 : 0

    return Promise.parallel(Self.benchmarkQueue) {
      do {
        let runner = try PoseModelRunner(size: intSize)
        let buffer = try Self.syntheticFrame()
        let infer = {
          let start = CACurrentMediaTime()
          _ = try runner.run(buffer, orientation: .up, uprightWidth: Self.frameWidth,
                             uprightHeight: Self.frameHeight, timestampMs: 0)
          return (CACurrentMediaTime() - start) * 1000
        }
        _ = try infer() // first run pays for Core ML's lazy model load; never counted
        let latencies = try TimedBenchmark.run(warmUp: warmUp, measure: measure,
                                               clock: CACurrentMediaTime, work: infer)
        guard let stats = BenchmarkMath.stats(size: intSize, latenciesMs: latencies) else {
          throw PoseError.badOutput("benchmark produced no samples")
        }
        return PoseBenchmark(size: Double(intSize), model: runner.model, meanMs: stats.meanMs,
                             p95Ms: stats.p95Ms, samples: Double(latencies.count))
      } catch {
        throw RuntimeError.error(withMessage: Self.message(for: error))
      }
    }
  }

  private static func validate(_ size: Double) throws {
    guard size == 320 || size == 256 else {
      throw RuntimeError.error(withMessage: "unsupported size \(format(size)); use 320 or 256")
    }
  }

  /// Prints whole numbers without a trailing ".0" so the message reads `unsupported size 300`.
  private static func format(_ size: Double) -> String {
    if size.isFinite, size == size.rounded(), abs(size) < 1e15 {
      return String(Int64(size))
    }
    return String(size)
  }

  private static func message(for error: Error) -> String {
    switch error {
    case PoseError.modelMissing(let name): return "model \(name) is not in the app bundle"
    case PoseError.badOutput(let detail): return detail
    default: return error.localizedDescription
    }
  }

  // MARK: Synthetic frame

  /// Portrait 1080p, the size the camera delivers once turned upright.
  private static let frameWidth = 1080
  private static let frameHeight = 1920

  /// A mid-gray full-range 4:2:0 buffer, the camera's own pixel format, so Vision does the same
  /// conversion and scaling work as on a live frame.
  private static func syntheticFrame() throws -> CVPixelBuffer {
    var buffer: CVPixelBuffer?
    let attributes = [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary
    let status = CVPixelBufferCreate(kCFAllocatorDefault, frameWidth, frameHeight,
                                     kCVPixelFormatType_420YpCbCr8BiPlanarFullRange, attributes, &buffer)
    guard status == kCVReturnSuccess, let buffer else {
      throw PoseError.badOutput("could not create benchmark frame (CVReturn \(status))")
    }
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    for plane in 0..<CVPixelBufferGetPlaneCount(buffer) {
      guard let base = CVPixelBufferGetBaseAddressOfPlane(buffer, plane) else { continue }
      // 128 is mid-gray luma and neutral chroma.
      memset(base, 128, CVPixelBufferGetBytesPerRowOfPlane(buffer, plane) * CVPixelBufferGetHeightOfPlane(buffer, plane))
    }
    return buffer
  }

  // MARK: Model fingerprint

  /// Computed once; the bundle cannot change while the app runs.
  private static let modelId = sizes.map(modelFingerprint).joined(separator: "+")

  /// `<modelName>@<export date>`, `<modelName>` when the model has no date, `<modelName>@missing` when absent.
  private static func modelFingerprint(size: Int) -> String {
    let name = ModelLocator.modelName(size: size)
    guard let url = try? ModelLocator.url(size: size, in: .main) else { return "\(name)@missing" }
    guard let date = exportDate(compiledModel: url), !date.isEmpty else { return name }
    return "\(name)@\(date)"
  }

  /// Ultralytics writes its export timestamp as the `date` creator-defined metadata entry.
  /// Reads it from the compiled model's metadata.json when present, which skips loading the model;
  /// otherwise asks Core ML for the model description.
  private static func exportDate(compiledModel url: URL) -> String? {
    if let data = try? Data(contentsOf: url.appendingPathComponent("metadata.json")),
       let entries = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]],
       let userDefined = entries.first?["userDefinedMetadata"] as? [String: Any] {
      return userDefined["date"] as? String
    }
    let config = MLModelConfiguration()
    config.computeUnits = .cpuOnly // only the description is needed
    guard let model = try? MLModel(contentsOf: url, configuration: config),
          let userDefined = model.modelDescription.metadata[.creatorDefinedKey] as? [String: String] else {
      return nil
    }
    return userDefined["date"]
  }
}
