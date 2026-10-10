import Vision
import XCTest
@testable import PoseCore

final class VisionPoseMapperTests: XCTestCase {
    typealias Name = VNHumanBodyPoseObservation.JointName

    /// Vision's names for the 17 COCO joints, in COCO order.
    private let cocoOrder: [Name] = [
        .nose, .leftEye, .rightEye, .leftEar, .rightEar,
        .leftShoulder, .rightShoulder, .leftElbow, .rightElbow,
        .leftWrist, .rightWrist, .leftHip, .rightHip,
        .leftKnee, .rightKnee, .leftAnkle, .rightAnkle,
    ]

    /// A person with every COCO joint at the same point and confidence.
    private func person(x: Float = 0.5, y: Float = 0.5, c: Float = 0.9) -> [Name: VisionPoint] {
        Dictionary(uniqueKeysWithValues: cocoOrder.map { ($0, VisionPoint(x: x, y: y, c: c)) })
    }

    private func map(_ people: [[Name: VisionPoint]]) -> PoseResult? {
        VisionPoseMapper.map(people: people, timestampMs: 42)
    }

    func testMapsEachVisionJointToItsCocoIndex() throws {
        // Joint k gets x = k / 100, so a swapped pair shows up as the wrong x.
        var p: [Name: VisionPoint] = [:]
        for (k, name) in cocoOrder.enumerated() {
            p[name] = VisionPoint(x: Float(k) / 100, y: 0.5, c: 0.9)
        }
        let result = try XCTUnwrap(map([p]))
        XCTAssertEqual(result.joints.count, 17)
        for k in 0..<17 {
            XCTAssertEqual(result.joints[k].x, Float(k) / 100, accuracy: 1e-6, PoseResult.jointNames[k])
        }
    }

    func testFlipsYToTopLeftOrigin() throws {
        // Vision's origin is bottom-left: a head near the top of the frame has a high y.
        var p = person()
        p[.nose] = VisionPoint(x: 0.4, y: 0.9, c: 0.9)
        p[.leftAnkle] = VisionPoint(x: 0.4, y: 0.1, c: 0.9)
        let result = try XCTUnwrap(map([p]))
        XCTAssertEqual(result.joints[0].y, 0.1, accuracy: 1e-6)
        XCTAssertEqual(result.joints[15].y, 0.9, accuracy: 1e-6)
        XCTAssertEqual(result.joints[0].x, 0.4, accuracy: 1e-6, "x is not flipped")
    }

    func testMissingJointIsZeroWithZeroConfidence() throws {
        var p = person()
        p[.leftWrist] = nil
        let j = try XCTUnwrap(map([p])).joints[9]
        XCTAssertEqual(j, Joint(x: 0, y: 0, c: 0))
    }

    func testZeroConfidencePointIsMissing() throws {
        // Vision reports undetected joints at (0, 0) with confidence 0; flipping y would give (0, 1).
        var p = person()
        p[.rightKnee] = VisionPoint(x: 0, y: 0, c: 0)
        XCTAssertEqual(try XCTUnwrap(map([p])).joints[14], Joint(x: 0, y: 0, c: 0))
    }

    func testScoreIsMeanOfAll17CountingMissingAsZero() throws {
        var p = person(c: 0.85)
        p[.leftWrist] = nil
        p[.rightWrist] = nil
        let result = try XCTUnwrap(map([p]))
        XCTAssertEqual(result.score, 0.85 * 15 / 17, accuracy: 1e-5)
    }

    func testIgnoresNeckAndRoot() throws {
        var p = person(c: 0.5)
        p[.neck] = VisionPoint(x: 0.1, y: 0.1, c: 1)
        p[.root] = VisionPoint(x: 0.1, y: 0.1, c: 1)
        let result = try XCTUnwrap(map([p]))
        XCTAssertEqual(result.score, 0.5, accuracy: 1e-6)
        XCTAssertFalse(result.joints.contains { $0.x == 0.1 })
    }

    func testReturnsNilBelowMinScore() {
        XCTAssertNil(map([person(c: 0.2)]))
        XCTAssertNotNil(map([person(c: 0.25)]), "0.25 itself counts as a person, like PoseDecoder")
    }

    func testReturnsNilWithNoPeople() {
        XCTAssertNil(map([]))
        XCTAssertNil(map([[:]]))
    }

    func testPicksHighestScoringPerson() throws {
        let result = try XCTUnwrap(map([person(x: 0.2, c: 0.5), person(x: 0.7, c: 0.8), person(x: 0.3, c: 0.6)]))
        XCTAssertEqual(result.score, 0.8, accuracy: 1e-6)
        XCTAssertEqual(result.joints[0].x, 0.7, accuracy: 1e-6)
    }

    func testClampsOutOfRangePoints() throws {
        var p = person()
        p[.nose] = VisionPoint(x: -0.1, y: 1.2, c: 0.9)
        let j = try XCTUnwrap(map([p])).joints[0]
        XCTAssertEqual(j.x, 0)
        XCTAssertEqual(j.y, 0)
    }

    func testStampsVisionSourceModelAndTime() throws {
        let result = try XCTUnwrap(map([person()]))
        XCTAssertEqual(result.source, .vision)
        XCTAssertEqual(result.model, "apple-vision-body-pose")
        XCTAssertEqual(result.timestampMs, 42)
    }

    func testVisionSourceEncodesAsVision() throws {
        let data = try JSONEncoder().encode(try XCTUnwrap(map([person()])))
        let json = try XCTUnwrap(String(data: data, encoding: .utf8))
        XCTAssertTrue(json.contains("\"source\":\"vision\""), json)
    }
}
