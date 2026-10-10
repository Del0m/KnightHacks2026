import PoseCore
import XCTest

final class FrameTimestampTests: XCTestCase {
    func testCaptureTimeExcludesProcessingDelay() throws {
        let timestamp = try FrameTimestamp.unixMilliseconds(presentationSeconds: 100,
                                                           hostSeconds: 100.25,
                                                           unixSeconds: 1_739_000_000.25)
        XCTAssertEqual(timestamp, 1_739_000_000_000)
    }

    func testFrameSpacingSurvivesDifferentProcessingDelays() throws {
        let first = try FrameTimestamp.unixMilliseconds(presentationSeconds: 100,
                                                       hostSeconds: 100.125,
                                                       unixSeconds: 1_739_000_000.125)
        let second = try FrameTimestamp.unixMilliseconds(presentationSeconds: 100.5,
                                                        hostSeconds: 100.875,
                                                        unixSeconds: 1_739_000_000.875)
        XCTAssertEqual(second - first, 500)
    }

    func testInvalidTimestampsThrow() {
        for invalid in [Double.nan, .infinity, -.infinity, Double.greatestFiniteMagnitude] {
            XCTAssertThrowsError(try FrameTimestamp.unixMilliseconds(presentationSeconds: invalid,
                                                                    hostSeconds: 100,
                                                                    unixSeconds: 1_739_000_000))
        }
    }
}
