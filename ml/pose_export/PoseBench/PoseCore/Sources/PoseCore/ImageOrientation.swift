import ImageIO

/// How a camera buffer's pixels are rotated relative to upright.
public enum FrameRotation: Sendable { case up, down, left, right }

/// Maps a buffer's rotation and mirroring to the orientation Vision needs to see it upright.
public enum ImageOrientation {
    /// Vision orientation for a buffer whose pixels are rotated by `rotation` (and mirrored if
    /// `mirrored`) relative to upright, plus the frame size once upright.
    /// `left`/`right` swap width and height, so a sideways buffer decodes without squashing.
    public static func vision(rotation: FrameRotation, mirrored: Bool, width: Int, height: Int)
        -> (orientation: CGImagePropertyOrientation, uprightWidth: Int, uprightHeight: Int) {
        switch rotation {
        case .up: return (mirrored ? .upMirrored : .up, width, height)
        case .down: return (mirrored ? .downMirrored : .down, width, height)
        case .left: return (mirrored ? .leftMirrored : .left, height, width)
        case .right: return (mirrored ? .rightMirrored : .right, height, width)
        }
    }
}
