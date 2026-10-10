import XCTest
@testable import PoseCore

final class BenchmarkTests: XCTestCase {
    func testMeanAndP95() throws {
        let s = try XCTUnwrap(BenchmarkMath.stats(size: 320, latenciesMs: (1...20).map(Double.init)))
        XCTAssertEqual(s.size, 320)
        XCTAssertEqual(s.meanMs, 10.5, accuracy: 1e-9)
        XCTAssertEqual(s.p95Ms, 19)
    }

    func testHolds15fpsBoundary() {
        XCTAssertTrue(BenchmarkStats(size: 256, meanMs: 10, p95Ms: 66.6).holds15fps)
        XCTAssertFalse(BenchmarkStats(size: 256, meanMs: 10, p95Ms: 66.7).holds15fps)
    }

    func testMarkdownRow() {
        let ok = BenchmarkStats(size: 256, meanMs: 6.24, p95Ms: 8.91)
        XCTAssertEqual(BenchmarkMath.markdownRow(ok, device: "iPhone14,5", os: "iOS 26.1"),
                       "| iPhone14,5 | iOS 26.1 | 256 | 6.2 | 8.9 | 160 | ✅ |")
        let slow = BenchmarkStats(size: 320, meanMs: 80, p95Ms: 95)
        XCTAssertTrue(BenchmarkMath.markdownRow(slow, device: "iPhone14,5", os: "iOS 26.1").hasSuffix("| ❌ |"))
    }

    func testEmptyStatsIsNil() {
        XCTAssertNil(BenchmarkMath.stats(size: 320, latenciesMs: []))
    }

    func testWarmUpDiscarded() throws {
        var run = BenchmarkRun(size: 256)
        for i in 0...19 {
            run.record(latencyMs: 999, personFound: true, at: Double(i) / 10)
            XCTAssertEqual(run.phase, .warmingUp, "t=\(Double(i) / 10)")
        }
        run.record(latencyMs: 5, personFound: true, at: 2.0)
        XCTAssertEqual(run.phase, .measuring)
        for i in 21...121 { run.record(latencyMs: 5, personFound: true, at: Double(i) / 10) }
        XCTAssertEqual(run.phase, .done)
        XCTAssertEqual(try XCTUnwrap(run.stats).meanMs, 5, accuracy: 1e-9) // no 999s from warm-up
    }

    func testTimerPausesWithoutPerson() throws {
        var run = BenchmarkRun(size: 256)
        for i in 0...19 { run.record(latencyMs: 999, personFound: true, at: Double(i) / 10) }
        for i in 20...70 { run.record(latencyMs: 5, personFound: true, at: Double(i) / 10) }   // 5 s measured
        for i in 71...199 { run.record(latencyMs: 777, personFound: false, at: Double(i) / 10) } // 12.9 s away
        XCTAssertEqual(run.phase, .measuring, "must not finish while nobody is in frame")
        XCTAssertNil(run.stats)
        for i in 200...250 { run.record(latencyMs: 7, personFound: true, at: Double(i) / 10) }  // 5 s more
        XCTAssertEqual(run.phase, .done)
        let s = try XCTUnwrap(run.stats)
        XCTAssertGreaterThanOrEqual(s.p95Ms, 5)
        XCTAssertLessThanOrEqual(s.p95Ms, 7) // no 777s from empty frames
    }
}
