import ImageIO
import XCTest
@testable import PoseCore

final class ImageOrientationTests: XCTestCase {
    private func check(_ rotation: FrameRotation, mirrored: Bool,
                       _ orientation: CGImagePropertyOrientation, _ width: Int, _ height: Int,
                       file: StaticString = #filePath, line: UInt = #line) {
        let r = ImageOrientation.vision(rotation: rotation, mirrored: mirrored, width: 1920, height: 1080)
        XCTAssertEqual(r.orientation, orientation, file: file, line: line)
        XCTAssertEqual(r.uprightWidth, width, file: file, line: line)
        XCTAssertEqual(r.uprightHeight, height, file: file, line: line)
    }

    func testUp() { check(.up, mirrored: false, .up, 1920, 1080) }

    func testDown() { check(.down, mirrored: false, .down, 1920, 1080) }

    func testRightSwapsSize() { check(.right, mirrored: false, .right, 1080, 1920) }

    func testLeftSwapsSize() { check(.left, mirrored: false, .left, 1080, 1920) }

    func testMirroredVariants() {
        check(.up, mirrored: true, .upMirrored, 1920, 1080)
        check(.down, mirrored: true, .downMirrored, 1920, 1080)
        check(.left, mirrored: true, .leftMirrored, 1080, 1920)
        check(.right, mirrored: true, .rightMirrored, 1080, 1920)
    }
}
