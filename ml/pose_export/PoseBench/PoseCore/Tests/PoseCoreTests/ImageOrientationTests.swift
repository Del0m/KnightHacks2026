import CoreImage
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

    func testRightSwapsSize() { check(.right, mirrored: false, .left, 1080, 1920) }

    func testLeftSwapsSize() { check(.left, mirrored: false, .right, 1080, 1920) }

    func testMirroredVariants() {
        check(.up, mirrored: true, .upMirrored, 1920, 1080)
        check(.down, mirrored: true, .downMirrored, 1920, 1080)
        check(.left, mirrored: true, .leftMirrored, 1080, 1920)
        check(.right, mirrored: true, .rightMirrored, 1080, 1920)
    }

    private func checkLandmarks(_ rotation: FrameRotation, mirrored: Bool, width: Int, height: Int,
                                landmarks: [CGPoint], file: StaticString = #filePath, line: UInt = #line) {
        let result = ImageOrientation.vision(rotation: rotation, mirrored: mirrored, width: width, height: height)
        let image = CIImage(color: .white).cropped(to: CGRect(x: 0, y: 0, width: width, height: height))
        let transform = image.orientationTransform(forExifOrientation: Int32(result.orientation.rawValue))
        let expected = [CGPoint(x: 0.5, y: 2.5), CGPoint(x: 1.5, y: 2.5), CGPoint(x: 0.5, y: 0.5)]
        XCTAssertEqual(result.uprightWidth, 2, file: file, line: line)
        XCTAssertEqual(result.uprightHeight, 3, file: file, line: line)
        for (landmark, upright) in zip(landmarks, expected) {
            let corrected = landmark.applying(transform)
            XCTAssertEqual(corrected.x, upright.x, accuracy: 0.001, file: file, line: line)
            XCTAssertEqual(corrected.y, upright.y, accuracy: 0.001, file: file, line: line)
        }
    }

    func testUprightLandmarksStayUpright() {
        checkLandmarks(.up, mirrored: false, width: 2, height: 3,
                       landmarks: [CGPoint(x: 0.5, y: 2.5), CGPoint(x: 1.5, y: 2.5), CGPoint(x: 0.5, y: 0.5)])
    }

    func testUpsideDownLandmarksBecomeUpright() {
        checkLandmarks(.down, mirrored: false, width: 2, height: 3,
                       landmarks: [CGPoint(x: 1.5, y: 0.5), CGPoint(x: 0.5, y: 0.5), CGPoint(x: 1.5, y: 2.5)])
    }

    func testCounterclockwiseBufferLandmarksBecomeUpright() {
        checkLandmarks(.left, mirrored: false, width: 3, height: 2,
                       landmarks: [CGPoint(x: 0.5, y: 0.5), CGPoint(x: 0.5, y: 1.5), CGPoint(x: 2.5, y: 0.5)])
    }

    func testClockwiseBufferLandmarksBecomeUpright() {
        checkLandmarks(.right, mirrored: false, width: 3, height: 2,
                       landmarks: [CGPoint(x: 2.5, y: 1.5), CGPoint(x: 2.5, y: 0.5), CGPoint(x: 0.5, y: 1.5)])
    }

    func testMirroredUprightLandmarksBecomeUnmirrored() {
        checkLandmarks(.up, mirrored: true, width: 2, height: 3,
                       landmarks: [CGPoint(x: 1.5, y: 2.5), CGPoint(x: 0.5, y: 2.5), CGPoint(x: 1.5, y: 0.5)])
    }

    func testMirroredUpsideDownLandmarksBecomeUprightAndUnmirrored() {
        checkLandmarks(.down, mirrored: true, width: 2, height: 3,
                       landmarks: [CGPoint(x: 0.5, y: 0.5), CGPoint(x: 1.5, y: 0.5), CGPoint(x: 0.5, y: 2.5)])
    }

    func testMirroredCounterclockwiseLandmarksBecomeUprightAndUnmirrored() {
        checkLandmarks(.left, mirrored: true, width: 3, height: 2,
                       landmarks: [CGPoint(x: 0.5, y: 1.5), CGPoint(x: 0.5, y: 0.5), CGPoint(x: 2.5, y: 1.5)])
    }

    func testMirroredClockwiseLandmarksBecomeUprightAndUnmirrored() {
        checkLandmarks(.right, mirrored: true, width: 3, height: 2,
                       landmarks: [CGPoint(x: 2.5, y: 0.5), CGPoint(x: 2.5, y: 1.5), CGPoint(x: 0.5, y: 0.5)])
    }

    func testNativeConnectionAnglesAccountForCameraMountAndExistingRotation() {
        let cases: [(Double, Double, CGImagePropertyOrientation, Int, Int)] = [
            (0, 0, .up, 1920, 1080),
            (0, 90, .left, 1080, 1920),
            (90, 180, .left, 1080, 1920),
            (90, 0, .right, 1080, 1920),
            (270, 0, .left, 1080, 1920),
            (0, 180, .down, 1920, 1080),
            (360, 0, .up, 1920, 1080),
        ]
        for (captureAngle, bufferAngle, orientation, width, height) in cases {
            let result = ImageOrientation.vision(captureRotationDegrees: captureAngle,
                                                 bufferRotationDegrees: bufferAngle,
                                                 mirrored: false, width: 1920, height: 1080)
            XCTAssertEqual(result.orientation, orientation)
            XCTAssertEqual(result.uprightWidth, width)
            XCTAssertEqual(result.uprightHeight, height)
        }
    }

    func testNativeConnectionAnglesPreserveUnmirroring() {
        let result = ImageOrientation.vision(captureRotationDegrees: 0, bufferRotationDegrees: 90,
                                             mirrored: true, width: 1920, height: 1080)
        XCTAssertEqual(result.orientation, .rightMirrored)
        XCTAssertEqual(result.uprightWidth, 1080)
        XCTAssertEqual(result.uprightHeight, 1920)
    }
}
