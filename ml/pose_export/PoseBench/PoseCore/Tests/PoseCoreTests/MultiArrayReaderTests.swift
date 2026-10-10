import CoreML
import XCTest
@testable import PoseCore

final class MultiArrayReaderTests: XCTestCase {
    private let n = 3
    private var expected: [Float] { (0..<56).flatMap { r in (0..<n).map { i in Float(r * 10 + i) } } }

    private func filled(_ type: MLMultiArrayDataType) throws -> MLMultiArray {
        let a = try MLMultiArray(shape: [1, 56, NSNumber(value: n)], dataType: type)
        for r in 0..<56 {
            for i in 0..<n { a[[0, NSNumber(value: r), NSNumber(value: i)]] = NSNumber(value: r * 10 + i) }
        }
        return a
    }

    func testReadsFloat32Contiguous() throws {
        XCTAssertEqual(try MultiArrayReader.floats(try filled(.float32)), expected)
    }

    func testReadsFloat16() throws {
        let got = try MultiArrayReader.floats(try filled(.float16))
        XCTAssertEqual(got.count, expected.count)
        for (g, e) in zip(got, expected) { XCTAssertEqual(g, e, accuracy: 0.01) }
    }

    func testReadsCustomStrides() throws {
        // Each row padded to 8 elements, as Core ML may do for alignment.
        let rowStride = 8
        let buffer = UnsafeMutablePointer<Float>.allocate(capacity: 56 * rowStride)
        buffer.initialize(repeating: -1, count: 56 * rowStride)
        for r in 0..<56 { for i in 0..<n { buffer[r * rowStride + i] = Float(r * 10 + i) } }
        let a = try MLMultiArray(dataPointer: buffer, shape: [1, 56, NSNumber(value: n)], dataType: .float32,
                                 strides: [NSNumber(value: 56 * rowStride), NSNumber(value: rowStride), 1],
                                 deallocator: { $0.deallocate() })
        XCTAssertEqual(try MultiArrayReader.floats(a), expected)
    }

    func testRejectsWrongRank() throws {
        let a = try MLMultiArray(shape: [56, 3], dataType: .float32)
        XCTAssertThrowsError(try MultiArrayReader.floats(a)) { error in
            guard case PoseError.badOutput = error else { return XCTFail("got \(error)") }
        }
    }

    func testRejectsWrongRowCount() throws {
        let a = try MLMultiArray(shape: [1, 55, 3], dataType: .float32)
        XCTAssertThrowsError(try MultiArrayReader.floats(a)) { error in
            guard case PoseError.badOutput = error else { return XCTFail("got \(error)") }
        }
    }
}
