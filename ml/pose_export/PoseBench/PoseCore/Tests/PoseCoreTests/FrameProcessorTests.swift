import CoreVideo
import XCTest
@testable import PoseCore

private final class FakeEstimator: PoseEstimating {
    let modelName = "fake"
    func estimate(_ buffer: CVPixelBuffer, timestampMs: Int64) throws -> (result: PoseResult?, latencyMs: Double) {
        let joints = Array(repeating: Joint(x: 0.5, y: 0.5, c: 1), count: 17)
        return (PoseResult(source: .coreml, model: modelName, timestampMs: timestampMs, score: 0.9, joints: joints), 5)
    }
}

final class FrameProcessorTests: XCTestCase {
    private func makeBuffer() throws -> CVPixelBuffer {
        var buffer: CVPixelBuffer?
        CVPixelBufferCreate(nil, 72, 128, kCVPixelFormatType_32BGRA, nil, &buffer)
        return try XCTUnwrap(buffer)
    }

    private func makeProcessor() -> FrameProcessor {
        FrameProcessor(estimators: [320: FakeEstimator(), 256: FakeEstimator()], liveSize: 320)
    }

    /// Reproduces the review's cancel race: a frame finished just before cancel must not
    /// revive the benchmark UI when it reaches the main actor afterwards.
    func testStaleBenchmarkOutputIgnoredAfterCancel() throws {
        let processor = makeProcessor()
        let generation = processor.startBenchmark(sizes: [320, 256])
        let inFlight = try XCTUnwrap(processor.process(try makeBuffer()))
        processor.cancelBenchmark()
        XCTAssertNotNil(inFlight.benchmarkEvent(activeGeneration: generation))
        XCTAssertNil(inFlight.benchmarkEvent(activeGeneration: nil), "UI cancelled; stale status must be dropped")
    }

    func testOutputFromPreviousRunIgnoredByNewRun() throws {
        let processor = makeProcessor()
        let first = processor.startBenchmark(sizes: [320])
        let old = try XCTUnwrap(processor.process(try makeBuffer()))
        let second = processor.startBenchmark(sizes: [320])
        XCTAssertNotEqual(first, second)
        XCTAssertNil(old.benchmarkEvent(activeGeneration: second))
    }

    func testNoBenchmarkEventWhenIdle() throws {
        let output = try XCTUnwrap(makeProcessor().process(try makeBuffer()))
        XCTAssertNil(output.benchmarkEvent(activeGeneration: nil))
        XCTAssertNotNil(output.result)
    }
}
