import Foundation

/// Turns YOLOv8n-pose's raw output into a `PoseResult`.
///
/// Raw layout is [56][n], one column per candidate:
/// rows 0–3 box (cx, cy, w, h), row 4 person confidence (0–1),
/// rows 5–55 are 17 × (x, y, visibility), x/y in input pixels, visibility 0–1.
/// The input was letterboxed by Vision's `.scaleFit` (centered padding), which is undone here.
/// The cloud endpoint mirrors these steps in Python; see docs/pose/how-it-works.md.
public enum PoseDecoder {
    public static let minScore: Float = 0.25

    /// - Parameters:
    ///   - output: flat row-major [56][n].
    ///   - frameWidth, frameHeight: the upright camera frame the model saw (before letterboxing).
    public static func decode(output: [Float], candidates n: Int, inputSize: Int,
                              frameWidth: Int, frameHeight: Int,
                              model: String, timestampMs: Int64) -> PoseResult? {
        precondition(output.count == 56 * n, "expected 56 × \(n) values, got \(output.count)")
        guard n > 0 else { return nil }

        // One person per frame: the most confident candidate wins, so no NMS.
        var best = 0
        for i in 1..<n where output[4 * n + i] > output[4 * n + best] {
            best = i
        }
        let score = output[4 * n + best]
        guard score >= minScore else { return nil }

        let input = Float(inputSize)
        let scale = input / Float(max(frameWidth, frameHeight))
        let contentW = Float(frameWidth) * scale
        let contentH = Float(frameHeight) * scale
        let padX = (input - contentW) / 2
        let padY = (input - contentH) / 2

        let joints = (0..<17).map { k -> Joint in
            let px = output[(5 + 3 * k) * n + best]
            let py = output[(6 + 3 * k) * n + best]
            return Joint(x: clamp((px - padX) / contentW),
                         y: clamp((py - padY) / contentH),
                         c: output[(7 + 3 * k) * n + best])
        }
        return PoseResult(source: .coreml, model: model, timestampMs: timestampMs, score: score, joints: joints)
    }

    private static func clamp(_ v: Float) -> Float { min(max(v, 0), 1) }
}
