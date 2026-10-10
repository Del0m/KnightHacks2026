import Foundation

/// Finds the models `export.py` produced. Xcode compiles each bundled `.mlpackage` to `.mlmodelc`.
public enum ModelLocator {
    public static func modelName(size: Int) -> String { "yolov8n-pose-\(size)" }

    public static func url(size: Int, in bundle: Bundle) throws -> URL {
        let name = modelName(size: size)
        guard let url = bundle.url(forResource: name, withExtension: "mlmodelc") else {
            throw PoseError.modelMissing(name)
        }
        return url
    }
}
