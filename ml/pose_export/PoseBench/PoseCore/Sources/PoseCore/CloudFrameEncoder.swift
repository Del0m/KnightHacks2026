import CoreImage
import CoreVideo
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// One camera frame ready for the cloud pose relay: an upright, unmirrored JPEG and its pixel size.
public struct EncodedCloudFrame: Sendable {
    public let jpeg: Data
    public let width: Int
    public let height: Int
}

/// Turns a camera frame into the small JPEG the cloud pose relay expects. The orientation from
/// `ImageOrientation.vision(...)` is baked into the pixels; the JPEG never carries an EXIF tag.
public enum CloudFrameEncoder {
    public static let defaultLongSide = 320
    public static let jpegQuality: CGFloat = 0.70

    /// Upright size scaled so the longest side is at most `longSide`, keeping the aspect ratio.
    /// Never upscales, and each side is at least 1.
    public static func targetSize(uprightWidth: Int, uprightHeight: Int, longSide: Int = defaultLongSide)
        -> (width: Int, height: Int) {
        let width = max(uprightWidth, 1), height = max(uprightHeight, 1)
        let scale = min(1, Double(max(longSide, 1)) / Double(max(width, height)))
        return (max(1, Int((Double(width) * scale).rounded())), max(1, Int((Double(height) * scale).rounded())))
    }

    public static func encode(_ pixelBuffer: CVPixelBuffer, orientation: CGImagePropertyOrientation,
                              context: CIContext, longSide: Int = defaultLongSide) throws -> EncodedCloudFrame {
        try encode(CIImage(cvPixelBuffer: pixelBuffer), orientation: orientation, context: context, longSide: longSide)
    }

    /// Throws `PoseError.badOutput` when the image is empty, unbounded, or cannot be encoded.
    public static func encode(_ image: CIImage, orientation: CGImagePropertyOrientation,
                              context: CIContext, longSide: Int = defaultLongSide) throws -> EncodedCloudFrame {
        let extent = image.extent
        guard !extent.isEmpty, !extent.isInfinite, extent.width >= 1, extent.height >= 1 else {
            throw PoseError.badOutput("cloud frame image is empty")
        }
        let upright = image.oriented(orientation)
        let source = upright.extent
        let size = targetSize(uprightWidth: Int(source.width.rounded()), uprightHeight: Int(source.height.rounded()),
                              longSide: longSide)
        let target = CGRect(x: 0, y: 0, width: size.width, height: size.height)

        // Separate x/y scales hit whole-pixel sizes exactly; clamping keeps the edges from fading
        // into transparent (black once in JPEG) while Lanczos samples past them.
        let scaleX = CGFloat(size.width) / source.width, scaleY = CGFloat(size.height) / source.height
        var scaled = upright.transformed(by: CGAffineTransform(translationX: -source.minX, y: -source.minY))
        if scaleX != 1 || scaleY != 1 {
            let filter = CIFilter(name: "CILanczosScaleTransform")!
            filter.setValue(scaled.clampedToExtent(), forKey: kCIInputImageKey)
            filter.setValue(scaleY, forKey: kCIInputScaleKey)
            filter.setValue(scaleX / scaleY, forKey: kCIInputAspectRatioKey)
            guard let output = filter.outputImage else {
                throw PoseError.badOutput("could not scale cloud frame")
            }
            scaled = output
        }

        let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
        guard let cgImage = context.createCGImage(scaled.cropped(to: target), from: target,
                                                  format: .RGBA8, colorSpace: colorSpace) else {
            throw PoseError.badOutput("could not render cloud frame")
        }
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw PoseError.badOutput("could not create JPEG encoder")
        }
        let options = [kCGImageDestinationLossyCompressionQuality: jpegQuality] as CFDictionary
        CGImageDestinationAddImage(destination, cgImage, options)
        guard CGImageDestinationFinalize(destination) else {
            throw PoseError.badOutput("could not encode cloud frame JPEG")
        }
        return EncodedCloudFrame(jpeg: data as Data, width: size.width, height: size.height)
    }
}
