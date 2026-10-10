import Foundation

/// Back-to-back timing on a fixed input: `work` runs until `warmUp` seconds pass and those results
/// are dropped, then runs until `measure` seconds pass. The clock is injected so tests need no real time.
public enum TimedBenchmark {
    /// Returns the measured latencies (ms) reported by `work`, always at least one.
    public static func run(warmUp: TimeInterval, measure: TimeInterval,
                           clock: () -> TimeInterval, work: () throws -> Double) rethrows -> [Double] {
        let warmUpStart = clock()
        while clock() - warmUpStart < warmUp {
            _ = try work()
        }

        let measureStart = clock()
        var latencies: [Double] = []
        repeat {
            latencies.append(try work())
        } while clock() - measureStart < measure
        return latencies
    }
}
