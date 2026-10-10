import Vision

/// One recognized Vision body point: normalized 0–1 with Vision's origin at the bottom-left.
public struct VisionPoint: Equatable, Sendable {
    public let x: Float
    public let y: Float
    /// Vision's per-joint confidence, 0–1.
    public let c: Float

    public init(x: Float, y: Float, c: Float) {
        self.x = x
        self.y = y
        self.c = c
    }
}

/// Maps Apple Vision body pose (`VNDetectHumanBodyPoseRequest`) to the 17-joint COCO `PoseResult`.
/// Vision's 19 points include all 17 COCO joints; `neck` and `root` are dropped.
/// Points must come from a request run with the frame's upright orientation (see `ImageOrientation`),
/// so they are already relative to the upright, unmirrored image.
public enum VisionPoseMapper {
    public static let model = "apple-vision-body-pose"
    /// Same cut-off as `PoseDecoder.minScore`.
    public static let minScore: Float = 0.25

    /// Vision's joint for each COCO index, in `PoseResult.jointNames` order.
    public static let cocoJoints: [VNHumanBodyPoseObservation.JointName] = [
        .nose, .leftEye, .rightEye, .leftEar, .rightEar,
        .leftShoulder, .rightShoulder, .leftElbow, .rightElbow,
        .leftWrist, .rightWrist, .leftHip, .rightHip,
        .leftKnee, .rightKnee, .leftAnkle, .rightAnkle,
    ]

    /// Returns the highest-scoring person, or `nil` when nobody reaches `minScore`.
    /// Score is the mean confidence of the 17 joints; a joint Vision did not detect is (0, 0) with c = 0.
    public static func map(people: [[VNHumanBodyPoseObservation.JointName: VisionPoint]],
                           timestampMs: Int64) -> PoseResult? {
        var best: (score: Float, joints: [Joint])?
        for points in people {
            let joints = cocoJoints.map { name -> Joint in
                // Vision reports undetected joints at (0, 0) with c = 0; treat them as missing.
                guard let p = points[name], p.c > 0 else { return Joint(x: 0, y: 0, c: 0) }
                return Joint(x: clamp(p.x), y: clamp(1 - p.y), c: p.c)
            }
            let score = joints.reduce(0) { $0 + $1.c } / Float(joints.count)
            if score > (best?.score ?? -1) { best = (score, joints) }
        }
        guard let best, best.score >= minScore else { return nil }
        return PoseResult(source: .vision, model: model, timestampMs: timestampMs,
                          score: best.score, joints: best.joints)
    }

    private static func clamp(_ v: Float) -> Float { min(max(v, 0), 1) }
}
