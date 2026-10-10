import CoreML

public enum PoseError: Error, Equatable {
    case modelMissing(String)
    case badOutput(String)
}

/// Copies the model's [1, 56, n] output into the flat row-major [56][n] layout `PoseDecoder` reads.
/// Core ML may hand back FP16 values and padded strides, so neither is assumed.
public enum MultiArrayReader {
    public static func floats(_ a: MLMultiArray) throws -> [Float] {
        let shape = a.shape.map(\.intValue)
        guard shape.count == 3, shape[0] == 1, shape[1] == 56 else {
            throw PoseError.badOutput("expected shape [1, 56, n], got \(shape)")
        }
        let n = shape[2]
        let rowStride = a.strides[1].intValue
        let colStride = a.strides[2].intValue
        var out = [Float](repeating: 0, count: 56 * n)

        // Raw bytes rather than withUnsafeBufferPointer(ofType:), whose Float16 support needs iOS 18.
        func copy<T>(_ type: T.Type, _ convert: (T) -> Float) {
            a.withUnsafeBytes { raw in
                guard let base = raw.baseAddress else { return }
                let src = base.assumingMemoryBound(to: T.self)
                for r in 0..<56 {
                    for i in 0..<n { out[r * n + i] = convert(src[r * rowStride + i * colStride]) }
                }
            }
        }

        switch a.dataType {
        case .float32:
            copy(Float.self) { $0 }
        case .double:
            copy(Double.self) { Float($0) }
        case .float16:
            #if arch(arm64)
            copy(Float16.self) { Float($0) }
            #else
            // Float16 isn't available on Intel Macs; this path only runs there in tests.
            for r in 0..<56 {
                for i in 0..<n { out[r * n + i] = a[[0, NSNumber(value: r), NSNumber(value: i)]].floatValue }
            }
            #endif
        default:
            throw PoseError.badOutput("unsupported output data type \(a.dataType.rawValue)")
        }
        return out
    }
}
