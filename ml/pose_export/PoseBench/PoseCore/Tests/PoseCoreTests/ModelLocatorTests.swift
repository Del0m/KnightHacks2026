import XCTest
@testable import PoseCore

final class ModelLocatorTests: XCTestCase {
    func testModelNameMatchesExportScript() {
        XCTAssertEqual(ModelLocator.modelName(size: 256), "yolov8n-pose-256")
    }

    func testMissingModelReportsError() {
        XCTAssertThrowsError(try ModelLocator.url(size: 320, in: Bundle(for: Self.self))) { error in
            XCTAssertEqual(error as? PoseError, .modelMissing("yolov8n-pose-320"))
        }
    }
}
