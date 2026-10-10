import XCTest
@testable import PoseCore

final class TimedBenchmarkTests: XCTestCase {
    /// Each call to `work` takes `step` seconds of fake time and reports `latencies[i]` (or the last one).
    private final class FakeRun {
        var now: TimeInterval = 100
        var calls = 0
        let step: TimeInterval
        let latencies: [Double]

        init(step: TimeInterval, latencies: [Double]) {
            self.step = step
            self.latencies = latencies
        }

        func work() -> Double {
            let latency = latencies[min(calls, latencies.count - 1)]
            calls += 1
            now += step
            return latency
        }
    }

    func testWarmUpDiscardedThenMeasuresWindow() throws {
        // 0.25 s per call (exact in binary, so no drift): 4 warm-up calls fill 1 s, then 8 calls fill 2 s.
        let fake = FakeRun(step: 0.25, latencies: Array(repeating: 999, count: 4) + [5])
        let latencies = TimedBenchmark.run(warmUp: 1, measure: 2, clock: { fake.now }, work: fake.work)
        XCTAssertEqual(fake.calls, 12)
        XCTAssertEqual(latencies.count, 8)
        XCTAssertFalse(latencies.contains(999), "warm-up results must be discarded")
        let s = try XCTUnwrap(BenchmarkMath.stats(size: 256, latenciesMs: latencies))
        XCTAssertEqual(s.meanMs, 5, accuracy: 1e-9)
    }

    func testAlwaysAtLeastOneSample() {
        // One call is longer than both windows: one warm-up call, then one measured call.
        let fake = FakeRun(step: 5, latencies: [999, 42])
        let latencies = TimedBenchmark.run(warmUp: 1, measure: 1, clock: { fake.now }, work: fake.work)
        XCTAssertEqual(latencies, [42])
    }

    func testZeroWindowsRunOnce() {
        let fake = FakeRun(step: 0.1, latencies: [7])
        let latencies = TimedBenchmark.run(warmUp: 0, measure: 0, clock: { fake.now }, work: fake.work)
        XCTAssertEqual(fake.calls, 1, "no warm-up calls when warmUp is 0")
        XCTAssertEqual(latencies, [7])
    }

    func testWorkErrorPropagates() {
        struct Boom: Error {}
        var now: TimeInterval = 0
        XCTAssertThrowsError(try TimedBenchmark.run(warmUp: 1, measure: 1, clock: { now }, work: {
            now += 0.1
            throw Boom()
        }))
    }
}
