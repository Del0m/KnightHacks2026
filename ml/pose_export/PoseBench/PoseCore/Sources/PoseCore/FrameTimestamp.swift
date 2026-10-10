import Foundation

public enum FrameTimestamp {
    public static func unixMilliseconds(presentationSeconds: Double, hostSeconds: Double,
                                        unixSeconds: Double) throws -> Int64 {
        let milliseconds = (unixSeconds - (hostSeconds - presentationSeconds)) * 1000
        guard presentationSeconds.isFinite, hostSeconds.isFinite, unixSeconds.isFinite,
              milliseconds > Double(Int64.min), milliseconds < Double(Int64.max) else {
            throw PoseError.badOutput("invalid frame timestamp")
        }
        return Int64(milliseconds)
    }
}
