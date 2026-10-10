import CoreGraphics
import CoreVideo
import Foundation
import QuartzCore

/// Frame in, joints out. The seam for cloud offloading: a later `RemotePoseEstimator` (CONN-11)
/// conforms to this, and nothing above it changes.
public protocol PoseEstimating: AnyObject {
    var modelName: String { get }
    /// `buffer` is upright and unmirrored.
    func estimate(_ buffer: CVPixelBuffer, timestampMs: Int64) throws -> (result: PoseResult?, latencyMs: Double)
}

/// Runs on the camera queue: inference plus benchmark bookkeeping. The lock guards state that the
/// main thread changes (live size, benchmark start/cancel).
public final class FrameProcessor: @unchecked Sendable {
    public enum BenchmarkEvent: Equatable {
        case status(String)
        case finished([BenchmarkStats])
    }

    public struct Output {
        public let result: PoseResult?
        public let latencyMs: Double
        public let frameSize: CGSize
        public let error: String?
        let benchmark: BenchmarkEvent?
        /// Which benchmark produced `benchmark`.
        let benchmarkGeneration: Int?

        /// The benchmark event, unless it belongs to a benchmark the UI has since cancelled or
        /// replaced. Frames finish on the camera queue and reach the main actor later, so an
        /// output computed just before a cancel can arrive just after it.
        public func benchmarkEvent(activeGeneration: Int?) -> BenchmarkEvent? {
            guard let generation = benchmarkGeneration, generation == activeGeneration else { return nil }
            return benchmark
        }
    }

    private let lock = NSLock()
    private let estimators: [Int: any PoseEstimating]
    private var liveSize: Int
    private var generation = 0
    private var pendingSizes: [Int] = []
    private var run: BenchmarkRun?
    private var finished: [BenchmarkStats] = []

    public init(estimators: [Int: any PoseEstimating], liveSize: Int) {
        self.estimators = estimators
        self.liveSize = liveSize
    }

    public func setLiveSize(_ size: Int) { lock.withLock { liveSize = size } }

    /// Returns the new benchmark's generation; pass it to `Output.benchmarkEvent(activeGeneration:)`.
    @discardableResult
    public func startBenchmark(sizes: [Int]) -> Int {
        lock.withLock {
            generation += 1
            finished = []
            pendingSizes = Array(sizes.dropFirst())
            run = sizes.first.map { BenchmarkRun(size: $0) }
            return generation
        }
    }

    public func cancelBenchmark() {
        lock.withLock {
            run = nil
            pendingSizes = []
        }
    }

    public func process(_ buffer: CVPixelBuffer) -> Output? {
        lock.withLock {
            let size = run?.size ?? liveSize
            guard let estimator = estimators[size] else { return nil }
            let frameSize = CGSize(width: CVPixelBufferGetWidth(buffer), height: CVPixelBufferGetHeight(buffer))
            let now = CACurrentMediaTime()
            do {
                let (result, latency) = try estimator.estimate(buffer, timestampMs: Int64(Date().timeIntervalSince1970 * 1000))
                let event = advanceBenchmark(latency: latency, personFound: result != nil, at: now)
                return Output(result: result, latencyMs: latency, frameSize: frameSize, error: nil,
                              benchmark: event, benchmarkGeneration: event == nil ? nil : generation)
            } catch {
                return Output(result: nil, latencyMs: 0, frameSize: frameSize,
                              error: "Inference failed: \(error.localizedDescription)",
                              benchmark: nil, benchmarkGeneration: nil)
            }
        }
    }

    /// Caller holds the lock.
    private func advanceBenchmark(latency: Double, personFound: Bool, at time: CFTimeInterval) -> BenchmarkEvent? {
        guard var current = run else { return nil }
        current.record(latencyMs: latency, personFound: personFound, at: time)
        guard current.phase == .done else {
            run = current
            let phase = current.phase == .warmingUp ? "warming up" : "measuring"
            return .status("Benchmarking \(current.size): \(phase)")
        }
        if let stats = current.stats { finished.append(stats) }
        if pendingSizes.isEmpty {
            run = nil
            return .finished(finished)
        }
        let next = pendingSizes.removeFirst()
        run = BenchmarkRun(size: next)
        return .status("Benchmarking \(next): warming up")
    }
}
