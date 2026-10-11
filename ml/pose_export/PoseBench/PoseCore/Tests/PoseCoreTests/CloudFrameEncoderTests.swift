import CoreImage
import CoreVideo
import ImageIO
import XCTest
@testable import PoseCore

final class CloudFrameEncoderTests: XCTestCase {
    private let context = CIContext()

    // MARK: targetSize

    func testTargetSizeShrinksLandscapeToLongSide() {
        let size = CloudFrameEncoder.targetSize(uprightWidth: 1920, uprightHeight: 1080)
        XCTAssertEqual(size.width, 320)
        XCTAssertEqual(size.height, 180)
    }

    func testTargetSizeShrinksPortraitToLongSide() {
        let size = CloudFrameEncoder.targetSize(uprightWidth: 1080, uprightHeight: 1920)
        XCTAssertEqual(size.width, 180)
        XCTAssertEqual(size.height, 320)
    }

    func testTargetSizeRoundsToNearestPixel() {
        let size = CloudFrameEncoder.targetSize(uprightWidth: 1000, uprightHeight: 333)
        XCTAssertEqual(size.width, 320)
        XCTAssertEqual(size.height, 107) // 106.56
    }

    func testTargetSizeNeverUpscales() {
        let small = CloudFrameEncoder.targetSize(uprightWidth: 100, uprightHeight: 50)
        XCTAssertEqual(small.width, 100)
        XCTAssertEqual(small.height, 50)
        let exact = CloudFrameEncoder.targetSize(uprightWidth: 320, uprightHeight: 240)
        XCTAssertEqual(exact.width, 320)
        XCTAssertEqual(exact.height, 240)
    }

    func testTargetSizeKeepsEachSideAtLeastOnePixel() {
        let size = CloudFrameEncoder.targetSize(uprightWidth: 5000, uprightHeight: 2)
        XCTAssertEqual(size.width, 320)
        XCTAssertEqual(size.height, 1)
    }

    func testTargetSizeHonoursCustomLongSide() {
        let size = CloudFrameEncoder.targetSize(uprightWidth: 1920, uprightHeight: 1080, longSide: 256)
        XCTAssertEqual(size.width, 256)
        XCTAssertEqual(size.height, 144)
    }

    // MARK: Orientation

    func testEveryOrientationComesOutUprightAndUnmirroredFromCIImage() throws {
        for orientation in Self.allOrientations {
            let raw = Fixture(orientation: orientation, uprightWidth: 64, uprightHeight: 40)
            let encoded = try CloudFrameEncoder.encode(raw.ciImage(), orientation: orientation, context: context)
            try assertUpright(encoded, width: 64, height: 40, orientation)
        }
    }

    func testEveryOrientationComesOutUprightAndUnmirroredFromPixelBuffer() throws {
        for orientation in Self.allOrientations {
            let raw = Fixture(orientation: orientation, uprightWidth: 64, uprightHeight: 40)
            let encoded = try CloudFrameEncoder.encode(raw.pixelBuffer(), orientation: orientation, context: context)
            try assertUpright(encoded, width: 64, height: 40, orientation)
        }
    }

    func testSidewaysCameraBufferIsRotatedAndShrunk() throws {
        // A portrait phone hands over a landscape 1920x1080 buffer that needs a quarter turn.
        for orientation in [CGImagePropertyOrientation.right, .left, .rightMirrored, .leftMirrored] {
            let raw = Fixture(orientation: orientation, uprightWidth: 1080, uprightHeight: 1920)
            XCTAssertEqual(raw.width, 1920)
            XCTAssertEqual(raw.height, 1080)
            let encoded = try CloudFrameEncoder.encode(raw.pixelBuffer(), orientation: orientation, context: context)
            try assertUpright(encoded, width: 180, height: 320, orientation)
        }
    }

    // MARK: Size

    func testLargeFramesFitTheLongSideAndKeepAspect() throws {
        for (width, height) in [(1920, 1080), (1080, 1920), (1000, 333), (641, 480)] {
            let raw = Fixture(orientation: .up, uprightWidth: width, uprightHeight: height)
            let encoded = try CloudFrameEncoder.encode(raw.ciImage(), orientation: .up, context: context)
            let image = try decode(encoded.jpeg)
            XCTAssertEqual(max(image.width, image.height), 320, "\(width)x\(height)")
            XCTAssertEqual(image.width, encoded.width)
            XCTAssertEqual(image.height, encoded.height)
            let expectedShort = Double(min(width, height)) * 320 / Double(max(width, height))
            XCTAssertEqual(Double(min(image.width, image.height)), expectedShort, accuracy: 1, "\(width)x\(height)")
        }
    }

    func testSmallFramesAreNotUpscaled() throws {
        let raw = Fixture(orientation: .right, uprightWidth: 24, uprightHeight: 40)
        let encoded = try CloudFrameEncoder.encode(raw.ciImage(), orientation: .right, context: context)
        let image = try decode(encoded.jpeg)
        XCTAssertEqual(image.width, 24)
        XCTAssertEqual(image.height, 40)
    }

    // MARK: Format

    func testOutputIsJpegWithoutOrientationTag() throws {
        let raw = Fixture(orientation: .left, uprightWidth: 64, uprightHeight: 40)
        let encoded = try CloudFrameEncoder.encode(raw.ciImage(), orientation: .left, context: context)
        XCTAssertEqual(Array(encoded.jpeg.prefix(2)), [0xFF, 0xD8])
        let source = try XCTUnwrap(CGImageSourceCreateWithData(encoded.jpeg as CFData, nil))
        XCTAssertEqual(CGImageSourceGetType(source) as String?, "public.jpeg")
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] ?? [:]
        let tag = (properties[kCGImagePropertyOrientation] as? NSNumber)?.intValue ?? 1
        XCTAssertEqual(tag, 1, "rotation must be in the pixels, not an EXIF tag")
    }

    func testUsesQualitySeventyPercent() {
        XCTAssertEqual(CloudFrameEncoder.jpegQuality, 0.70, accuracy: 0.0001)
        XCTAssertEqual(CloudFrameEncoder.defaultLongSide, 320)
    }

    // MARK: Errors

    func testEmptyImageThrows() {
        XCTAssertThrowsError(try CloudFrameEncoder.encode(CIImage.empty(), orientation: .up, context: context)) {
            XCTAssertTrue($0 is PoseError)
        }
    }

    func testInfiniteImageThrows() {
        XCTAssertThrowsError(try CloudFrameEncoder.encode(CIImage(color: .red), orientation: .up, context: context)) {
            XCTAssertTrue($0 is PoseError)
        }
    }

    func testZeroSizedImageThrows() {
        let image = CIImage(color: .red).cropped(to: CGRect(x: 0, y: 0, width: 0, height: 10))
        XCTAssertThrowsError(try CloudFrameEncoder.encode(image, orientation: .up, context: context)) {
            XCTAssertTrue($0 is PoseError)
        }
    }

    // MARK: Helpers

    private static let allOrientations: [CGImagePropertyOrientation] =
        [.up, .upMirrored, .down, .downMirrored, .leftMirrored, .right, .rightMirrored, .left]

    /// Corner colours of the upright image: top-left red, top-right green, bottom-left blue,
    /// bottom-right yellow. Any rotation or mirroring error swaps at least two of them.
    private enum Marker: Equatable { case red, green, blue, yellow }

    private func assertUpright(_ encoded: EncodedCloudFrame, width: Int, height: Int,
                               _ orientation: CGImagePropertyOrientation,
                               file: StaticString = #filePath, line: UInt = #line) throws {
        let image = try decode(encoded.jpeg)
        let label = "orientation \(orientation.rawValue)"
        XCTAssertEqual(image.width, width, label, file: file, line: line)
        XCTAssertEqual(image.height, height, label, file: file, line: line)
        XCTAssertEqual(encoded.width, width, label, file: file, line: line)
        XCTAssertEqual(encoded.height, height, label, file: file, line: line)
        let pixels = try rgba(image)
        func marker(_ fx: Double, _ fy: Double) -> Marker? {
            let x = Int(Double(image.width) * fx), y = Int(Double(image.height) * fy)
            let i = (y * image.width + x) * 4
            return Self.classify(pixels[i], pixels[i + 1], pixels[i + 2])
        }
        XCTAssertEqual(marker(0.25, 0.25), .red, "top-left, \(label)", file: file, line: line)
        XCTAssertEqual(marker(0.75, 0.25), .green, "top-right, \(label)", file: file, line: line)
        XCTAssertEqual(marker(0.25, 0.75), .blue, "bottom-left, \(label)", file: file, line: line)
        XCTAssertEqual(marker(0.75, 0.75), .yellow, "bottom-right, \(label)", file: file, line: line)
    }

    private static func classify(_ r: UInt8, _ g: UInt8, _ b: UInt8) -> Marker? {
        let high: UInt8 = 160, low: UInt8 = 96
        switch (r, g, b) {
        case (high..., ..<low, ..<low): return .red
        case (..<low, high..., ..<low): return .green
        case (..<low, ..<low, high...): return .blue
        case (high..., high..., ..<low): return .yellow
        default: return nil
        }
    }

    private func decode(_ jpeg: Data) throws -> CGImage {
        let source = try XCTUnwrap(CGImageSourceCreateWithData(jpeg as CFData, nil))
        return try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
    }

    /// Top-left-origin RGBA8 pixels in sRGB.
    private func rgba(_ image: CGImage) throws -> [UInt8] {
        var pixels = [UInt8](repeating: 0, count: image.width * image.height * 4)
        let drawn: Bool = pixels.withUnsafeMutableBytes { buffer in
            guard let ctx = CGContext(data: buffer.baseAddress, width: image.width, height: image.height,
                                      bitsPerComponent: 8, bytesPerRow: image.width * 4,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
            return true
        }
        XCTAssertTrue(drawn)
        return pixels
    }

    /// A raw camera buffer whose pixels need `orientation` to look upright. Built pixel by pixel from
    /// the EXIF definitions, independently of Core Image.
    private struct Fixture {
        let width: Int
        let height: Int
        let bgra: [UInt8]

        init(orientation: CGImagePropertyOrientation, uprightWidth W: Int, uprightHeight H: Int) {
            let swaps: Bool
            switch orientation {
            case .left, .right, .leftMirrored, .rightMirrored: swaps = true
            default: swaps = false
            }
            width = swaps ? H : W
            height = swaps ? W : H
            var bytes = [UInt8](repeating: 255, count: width * height * 4)
            for y in 0..<height {
                for x in 0..<width {
                    // Upright pixel shown at raw (x, y), with (0, 0) the top-left of each.
                    let (ux, uy): (Int, Int)
                    switch orientation {
                    case .up: (ux, uy) = (x, y)
                    case .upMirrored: (ux, uy) = (W - 1 - x, y)
                    case .down: (ux, uy) = (W - 1 - x, H - 1 - y)
                    case .downMirrored: (ux, uy) = (x, H - 1 - y)
                    case .leftMirrored: (ux, uy) = (y, x)
                    case .right: (ux, uy) = (W - 1 - y, x)
                    case .rightMirrored: (ux, uy) = (W - 1 - y, H - 1 - x)
                    case .left: (ux, uy) = (y, H - 1 - x)
                    @unknown default: (ux, uy) = (x, y)
                    }
                    let left = ux < W / 2, top = uy < H / 2
                    let (r, g, b): (UInt8, UInt8, UInt8)
                    switch (left, top) {
                    case (true, true): (r, g, b) = (230, 20, 20)
                    case (false, true): (r, g, b) = (20, 210, 20)
                    case (true, false): (r, g, b) = (20, 20, 230)
                    case (false, false): (r, g, b) = (230, 220, 20)
                    }
                    let i = (y * width + x) * 4
                    bytes[i] = b; bytes[i + 1] = g; bytes[i + 2] = r
                }
            }
            bgra = bytes
        }

        func ciImage() -> CIImage {
            let provider = CGDataProvider(data: Data(bgra) as CFData)!
            let image = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
                                bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipFirst.rawValue
                                    | CGBitmapInfo.byteOrder32Little.rawValue),
                                provider: provider, decode: nil, shouldInterpolate: false,
                                intent: .defaultIntent)!
            return CIImage(cgImage: image)
        }

        func pixelBuffer() throws -> CVPixelBuffer {
            var buffer: CVPixelBuffer?
            let status = CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
                                             nil, &buffer)
            let pixelBuffer = try XCTUnwrap(buffer)
            XCTAssertEqual(status, kCVReturnSuccess)
            CVPixelBufferLockBaseAddress(pixelBuffer, [])
            defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }
            let base = try XCTUnwrap(CVPixelBufferGetBaseAddress(pixelBuffer))
            let stride = CVPixelBufferGetBytesPerRow(pixelBuffer)
            bgra.withUnsafeBytes { source in
                for row in 0..<height {
                    memcpy(base + row * stride, source.baseAddress! + row * width * 4, width * 4)
                }
            }
            return pixelBuffer
        }
    }
}
