import XCTest
@testable import PoseCore

final class PoseDecoderTests: XCTestCase {
    /// Raw [56][n] output: column `best` gets `score` and the same keypoint (x, y) for all 17 joints, visibility 1.
    private func makeOutput(n: Int, best: Int, score: Float, kpt: (Float, Float)) -> [Float] {
        var out = [Float](repeating: 0, count: 56 * n)
        out[4 * n + best] = score
        for k in 0..<17 {
            out[(5 + 3 * k) * n + best] = kpt.0
            out[(6 + 3 * k) * n + best] = kpt.1
            out[(7 + 3 * k) * n + best] = 1
        }
        return out
    }

    private func decode(_ out: [Float], n: Int, input: Int = 256, frame: (Int, Int) = (1080, 1920)) -> PoseResult? {
        PoseDecoder.decode(output: out, candidates: n, inputSize: input,
                           frameWidth: frame.0, frameHeight: frame.1,
                           model: "yolov8n-pose-\(input)", timestampMs: 42)
    }

    func testPicksMostConfidentCandidate() throws {
        var out = makeOutput(n: 2, best: 1, score: 0.9, kpt: (128, 128))
        out[4 * 2 + 0] = 0.6
        out[5 * 2 + 0] = 56 // candidate 0's nose x would map to 0.0
        let result = try XCTUnwrap(decode(out, n: 2))
        XCTAssertEqual(result.score, 0.9)
        XCTAssertEqual(result.joints[0].x, 0.5, accuracy: 1e-5)
    }

    func testReturnsNilBelowThreshold() {
        XCTAssertNil(decode(makeOutput(n: 3, best: 0, score: 0.2, kpt: (128, 128)), n: 3))
    }

    func testAlways17JointsInCocoOrder() throws {
        let result = try XCTUnwrap(decode(makeOutput(n: 1, best: 0, score: 0.9, kpt: (128, 128)), n: 1))
        XCTAssertEqual(result.joints.count, 17)
        XCTAssertEqual(PoseResult.jointNames.count, 17)
        XCTAssertEqual(PoseResult.jointNames.first, "nose")
        XCTAssertEqual(PoseResult.jointNames.last, "right_ankle")
    }

    func testUndoesPaddingFor9x16Frame() throws {
        let cases: [((Float, Float), (Float, Float))] = [((56, 0), (0, 0)), ((200, 256), (1, 1)), ((128, 128), (0.5, 0.5))]
        for (input, expected) in cases {
            let j = try XCTUnwrap(decode(makeOutput(n: 1, best: 0, score: 0.9, kpt: input), n: 1)).joints[0]
            XCTAssertEqual(j.x, expected.0, accuracy: 1e-5, "x for \(input)")
            XCTAssertEqual(j.y, expected.1, accuracy: 1e-5, "y for \(input)")
        }
    }

    func testUndoesPaddingFor3x4Frame() throws {
        let cases: [((Float, Float), (Float, Float))] = [((160, 160), (0.5, 0.5)), ((40, 0), (0, 0))]
        for (input, expected) in cases {
            let out = makeOutput(n: 1, best: 0, score: 0.9, kpt: input)
            let j = try XCTUnwrap(decode(out, n: 1, input: 320, frame: (1080, 1440))).joints[0]
            XCTAssertEqual(j.x, expected.0, accuracy: 1e-5, "x for \(input)")
            XCTAssertEqual(j.y, expected.1, accuracy: 1e-5, "y for \(input)")
        }
    }

    func testClampsToUnitRange() throws {
        let j = try XCTUnwrap(decode(makeOutput(n: 1, best: 0, score: 0.9, kpt: (0, 0)), n: 1)).joints[0]
        XCTAssertEqual(j.x, 0)
    }

    func testJSONUsesSnakeCaseTimestamp() throws {
        let result = try XCTUnwrap(decode(makeOutput(n: 1, best: 0, score: 0.9, kpt: (128, 128)), n: 1))
        let json = String(decoding: try JSONEncoder().encode(result), as: UTF8.self)
        XCTAssertTrue(json.contains("\"timestamp_ms\""), json)
        XCTAssertTrue(json.contains("\"source\":\"coreml\""), json)
    }
}
