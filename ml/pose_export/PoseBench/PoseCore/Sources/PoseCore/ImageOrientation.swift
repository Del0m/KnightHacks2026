import ImageIO

/// How a camera buffer's pixels are rotated relative to upright.
public enum FrameRotation: Sendable { case up, down, left, right }

/// Maps a buffer's rotation and mirroring to the orientation Vision needs to see it upright.
public enum ImageOrientation {
    public static func vision(captureRotationDegrees: Double, bufferRotationDegrees: Double,
                              mirrored: Bool, width: Int, height: Int)
        -> (orientation: CGImagePropertyOrientation, uprightWidth: Int, uprightHeight: Int) {
        let quarterTurns = Int(((bufferRotationDegrees - captureRotationDegrees) / 90).rounded())
        let normalized = ((quarterTurns % 4) + 4) % 4
        let rotation: FrameRotation
        switch normalized {
        case 1: rotation = .right
        case 2: rotation = .down
        case 3: rotation = .left
        default: rotation = .up
        }
        return vision(rotation: rotation, mirrored: mirrored, width: width, height: height)
    }

    /// Vision orientation that counter-rotates a buffer by `rotation`, then unmirrors it if
    /// `mirrored`, plus the frame size once upright. EXIF's unmirrored left/right names describe
    /// the correction direction, opposite to the buffer's rotation.
    /// `left`/`right` swap width and height, so a sideways buffer decodes without squashing.
    public static func vision(rotation: FrameRotation, mirrored: Bool, width: Int, height: Int)
        -> (orientation: CGImagePropertyOrientation, uprightWidth: Int, uprightHeight: Int) {
        switch rotation {
        case .up: return (mirrored ? .upMirrored : .up, width, height)
        case .down: return (mirrored ? .downMirrored : .down, width, height)
        case .left: return (mirrored ? .leftMirrored : .right, height, width)
        case .right: return (mirrored ? .rightMirrored : .left, height, width)
        }
    }
}
