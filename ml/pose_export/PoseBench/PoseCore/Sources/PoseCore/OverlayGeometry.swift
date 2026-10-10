import CoreGraphics

/// Places joints over a camera preview shown with aspect-fit (`.resizeAspect`).
public enum OverlayGeometry {
    /// COCO skeleton, as pairs of `PoseResult.jointNames` indices.
    public static let bones: [(Int, Int)] = [
        (0, 1), (0, 2), (1, 3), (2, 4),             // face
        (5, 6), (5, 11), (6, 12), (11, 12),         // torso
        (5, 7), (7, 9), (6, 8), (8, 10),            // arms
        (11, 13), (13, 15), (12, 14), (14, 16),     // legs
    ]

    /// Joints are in the unmirrored image. The front-camera preview is mirrored, so `mirrored`
    /// flips x to keep the drawn joint on top of the body part you see.
    public static func point(_ j: Joint, imageSize: CGSize, viewSize: CGSize, mirrored: Bool) -> CGPoint {
        let scale = min(viewSize.width / imageSize.width, viewSize.height / imageSize.height)
        let fitted = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
        let origin = CGPoint(x: (viewSize.width - fitted.width) / 2, y: (viewSize.height - fitted.height) / 2)
        let x = mirrored ? 1 - CGFloat(j.x) : CGFloat(j.x)
        return CGPoint(x: origin.x + x * fitted.width, y: origin.y + CGFloat(j.y) * fitted.height)
    }
}
