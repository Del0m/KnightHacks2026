import AVFoundation
import PoseCore
import QuartzCore
import UIKit

/// Wires camera → estimator → benchmark → UI state.
@MainActor
final class PoseBenchModel: ObservableObject {
    static let sizes = [320, 256]
    static let liveFrameInterval = 1.0 / 15

    @Published var size = 320 { didSet { processor.setLiveSize(size) } }
    @Published var cameraPosition: AVCaptureDevice.Position = .front { didSet { camera.position = cameraPosition } }
    @Published private(set) var pose: PoseResult?
    @Published private(set) var frameSize = CGSize(width: 720, height: 1280)
    @Published private(set) var latencyMs: Double?
    @Published private(set) var fps: Double = 0
    @Published private(set) var availableSizes: [Int] = []
    @Published private(set) var errorMessage: String?
    @Published private(set) var cameraDenied = false
    @Published private(set) var benchmarkStatus: String?
    @Published private(set) var rows: [String] = []

    let camera = CameraFeed()
    private let processor: FrameProcessor
    private var frameTimes: [CFTimeInterval] = []
    /// Generation of the running benchmark; nil when none. Outputs from other generations are
    /// stale (finished on the camera queue before a cancel or restart) and their events are dropped.
    @Published private var activeBenchmark: Int?

    var isBenchmarking: Bool { activeBenchmark != nil }

    init() {
        var estimators: [Int: any PoseEstimating] = [:]
        var problems: [String] = []
        for size in Self.sizes {
            do {
                estimators[size] = try CoreMLPoseEstimator(size: size)
            } catch PoseError.modelMissing(let name) {
                problems.append("\(name) is missing. Run `uv run export.py` first.")
            } catch {
                problems.append("\(ModelLocator.modelName(size: size)) failed to load: \(error.localizedDescription)")
            }
        }
        let available = Self.sizes.filter { estimators[$0] != nil }
        let liveSize = available.first ?? Self.sizes[0]
        processor = FrameProcessor(estimators: estimators, liveSize: liveSize)
        availableSizes = available
        size = liveSize
        errorMessage = problems.isEmpty ? nil : problems.joined(separator: "\n")
        camera.position = cameraPosition
        camera.onFrame = { [processor, weak self] buffer in
            guard let output = processor.process(buffer) else { return }
            Task { @MainActor in self?.apply(output) }
        }
    }

    func start() async {
        guard !availableSizes.isEmpty else { return }
        guard await AVCaptureDevice.requestAccess(for: .video) else {
            cameraDenied = true
            return
        }
        camera.start()
    }

    func runBenchmark() {
        guard !isBenchmarking, !availableSizes.isEmpty else { return }
        rows = []
        benchmarkStatus = "Point at a person"
        camera.minFrameInterval = 0 // measure the ceiling, not the throttle
        activeBenchmark = processor.startBenchmark(sizes: availableSizes)
    }

    func cancelBenchmark() {
        guard isBenchmarking else { return }
        processor.cancelBenchmark()
        activeBenchmark = nil
        camera.minFrameInterval = Self.liveFrameInterval
        benchmarkStatus = nil
        errorMessage = "Benchmark cancelled because the app left the foreground. Run it again."
    }

    func copyRows() {
        UIPasteboard.general.string = ([BenchmarkMath.tableHeader] + rows).joined(separator: "\n")
    }

    private func apply(_ output: FrameProcessor.Output) {
        pose = output.result
        latencyMs = output.latencyMs
        frameSize = output.frameSize
        if let message = output.error { errorMessage = message }

        let now = CACurrentMediaTime()
        frameTimes.append(now)
        frameTimes.removeAll { now - $0 > 1 }
        fps = Double(frameTimes.count)

        switch output.benchmarkEvent(activeGeneration: activeBenchmark) {
        case .none:
            break
        case .status(let text):
            benchmarkStatus = output.result == nil ? "Point at a person" : text
        case .finished(let stats):
            rows = stats.map { BenchmarkMath.markdownRow($0, device: Self.deviceModel, os: Self.osVersion) }
            activeBenchmark = nil
            benchmarkStatus = nil
            camera.minFrameInterval = Self.liveFrameInterval
        }
    }

    /// Machine identifier, e.g. "iPhone14,5".
    private static let deviceModel: String = {
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
    }()

    private static var osVersion: String { "iOS \(UIDevice.current.systemVersion)" }
}
