import CoreGraphics
import XCTest
@testable import PoseCore

final class OverlayGeometryTests: XCTestCase {
    private let image = CGSize(width: 1080, height: 1920)
    private let view = CGSize(width: 390, height: 844)

    private func point(_ x: Float, _ y: Float, mirrored: Bool = false) -> CGPoint {
        OverlayGeometry.point(Joint(x: x, y: y, c: 1), imageSize: image, viewSize: view, mirrored: mirrored)
    }

    func testBackCameraCenter() {
        let p = point(0.5, 0.5)
        XCTAssertEqual(p.x, 195, accuracy: 0.1)
        XCTAssertEqual(p.y, 422, accuracy: 0.1)
    }

    func testBackCameraTopLeft() {
        let p = point(0, 0)
        XCTAssertEqual(p.x, 0, accuracy: 0.1)
        XCTAssertEqual(p.y, 75.3, accuracy: 0.1)
    }

    func testFrontCameraMirrorsX() {
        XCTAssertEqual(point(0.2, 0.5, mirrored: true).x, 312, accuracy: 0.1)
        XCTAssertEqual(point(0.2, 0.5, mirrored: false).x, 78, accuracy: 0.1)
    }

    func testBonesReferenceValidJoints() {
        XCTAssertFalse(OverlayGeometry.bones.isEmpty)
        for (a, b) in OverlayGeometry.bones {
            XCTAssertTrue((0..<17).contains(a) && (0..<17).contains(b), "\(a)-\(b)")
        }
    }
}
