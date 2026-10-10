import Foundation

/// One joint, normalized 0–1 in the upright, unmirrored camera image (origin top-left).
public struct Joint: Equatable, Codable, Sendable {
    public let x: Float
    public let y: Float
    /// Per-joint confidence, 0–1.
    public let c: Float

    public init(x: Float, y: Float, c: Float) {
        self.x = x
        self.y = y
        self.c = c
    }
}

public enum PoseSource: String, Codable, Sendable {
    case coreml
    /// Apple Vision body pose, the manual basic mode on iPhone.
    case vision
    case cloud
}

/// The pose result contract shared by on-device inference and the cloud endpoint (CONN-11).
/// See docs/pose/pose-result-contract.md. No person found is `nil`, never an empty `joints`.
public struct PoseResult: Equatable, Codable, Sendable {
    /// COCO keypoint order; `joints[i]` is `jointNames[i]`.
    public static let jointNames = [
        "nose", "left_eye", "right_eye", "left_ear", "right_ear",
        "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
        "left_wrist", "right_wrist", "left_hip", "right_hip",
        "left_knee", "right_knee", "left_ankle", "right_ankle",
    ]

    public let source: PoseSource
    public let model: String
    public let timestampMs: Int64
    /// Person-detection confidence, 0–1.
    public let score: Float
    /// Always 17 entries, in `jointNames` order.
    public let joints: [Joint]

    public init(source: PoseSource, model: String, timestampMs: Int64, score: Float, joints: [Joint]) {
        self.source = source
        self.model = model
        self.timestampMs = timestampMs
        self.score = score
        self.joints = joints
    }

    enum CodingKeys: String, CodingKey {
        case source, model, score, joints
        case timestampMs = "timestamp_ms"
    }
}
