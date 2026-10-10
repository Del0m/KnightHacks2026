import Foundation

public struct BenchmarkStats: Equatable, Sendable {
    public let size: Int
    public let meanMs: Double
    public let p95Ms: Double

    public init(size: Int, meanMs: Double, p95Ms: Double) {
        self.size = size
        self.meanMs = meanMs
        self.p95Ms = p95Ms
    }

    /// The phone's ceiling if it ran inference back to back.
    public var maxFps: Double { 1000 / meanMs }
    /// 15 fps leaves 66.7 ms per frame; judged on p95 so occasional slow frames count.
    public var holds15fps: Bool { p95Ms < 66.7 }
}

public enum BenchmarkMath {
    public static let tableHeader = """
        | Phone | iOS | Size | Mean ms | p95 ms | Max fps | Holds 15 fps |
        |---|---|---|---|---|---|---|
        """

    public static func stats(size: Int, latenciesMs: [Double]) -> BenchmarkStats? {
        guard !latenciesMs.isEmpty else { return nil }
        let sorted = latenciesMs.sorted()
        let mean = sorted.reduce(0, +) / Double(sorted.count)
        // Nearest-rank percentile.
        let rank = Int((0.95 * Double(sorted.count)).rounded(.up)) - 1
        return BenchmarkStats(size: size, meanMs: mean, p95Ms: sorted[rank])
    }

    public static func markdownRow(_ s: BenchmarkStats, device: String, os: String) -> String {
        let cells = [
            device, os, "\(s.size)",
            String(format: "%.1f", s.meanMs), String(format: "%.1f", s.p95Ms),
            "\(Int(s.maxFps.rounded()))", s.holds15fps ? "✅" : "❌",
        ]
        return "| " + cells.joined(separator: " | ") + " |"
    }
}

/// Timing for one model size: a wall-clock warm-up that is discarded, then a measurement window
/// that only advances while a person is in frame, so walking out pauses it instead of skewing it.
public struct BenchmarkRun {
    public enum Phase: Equatable { case warmingUp, measuring, done }

    public let size: Int
    public private(set) var phase: Phase = .warmingUp

    private let warmUp: TimeInterval
    private let measure: TimeInterval
    private var startTime: TimeInterval?
    private var previous: (time: TimeInterval, measuredWithPerson: Bool)?
    private var measured: TimeInterval = 0
    private var latencies: [Double] = []

    public init(size: Int, warmUp: TimeInterval = 2, measure: TimeInterval = 10) {
        self.size = size
        self.warmUp = warmUp
        self.measure = measure
    }

    public mutating func record(latencyMs: Double, personFound: Bool, at time: TimeInterval) {
        guard phase != .done else { return }
        let start = startTime ?? time
        startTime = start
        if phase == .warmingUp {
            guard time - start >= warmUp else { return }
            phase = .measuring
        }

        if personFound {
            latencies.append(latencyMs)
            if let prev = previous, prev.measuredWithPerson {
                measured += time - prev.time
            }
        }
        previous = (time, personFound)
        // Tolerance absorbs floating-point drift from summing frame intervals.
        if measured >= measure - 1e-6 {
            phase = .done
        }
    }

    public var stats: BenchmarkStats? {
        phase == .done ? BenchmarkMath.stats(size: size, latenciesMs: latencies) : nil
    }
}
