import AVFoundation
import QuartzCore

/// Delivers upright, unmirrored camera frames on a serial queue, dropping frames that arrive
/// sooner than `minFrameInterval` after the last accepted one (dropped, never queued, so the
/// skeleton never lags behind the body).
final class CameraFeed: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    let session = AVCaptureSession()
    /// Called on the camera queue.
    var onFrame: ((CVPixelBuffer) -> Void)?
    /// Called on the camera queue after the session is (re)configured, e.g. a camera switch,
    /// which rebuilds the preview layer's connection.
    var onReconfigure: (() -> Void)?

    var position: AVCaptureDevice.Position = .front {
        didSet {
            queue.async {
                self.configure()
                self.onReconfigure?()
            }
        }
    }

    /// Set from any thread; read on the camera queue.
    var minFrameInterval: TimeInterval {
        get { queue.sync { interval } }
        set { queue.async { self.interval = newValue } }
    }

    private let queue = DispatchQueue(label: "posebench.camera")
    private let output = AVCaptureVideoDataOutput()
    private var interval: TimeInterval = 1.0 / 15
    private var lastAccepted: CFTimeInterval = 0

    func start() {
        queue.async {
            self.configure()
            self.session.startRunning()
            self.onReconfigure?()
        }
    }

    private func configure() {
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = .hd1280x720
        session.inputs.forEach(session.removeInput)
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else { return }
        session.addInput(input)

        if !session.outputs.contains(output), session.canAddOutput(output) {
            output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
            output.alwaysDiscardsLateVideoFrames = true
            output.setSampleBufferDelegate(self, queue: queue)
            session.addOutput(output)
        }
        // Rotate to portrait and keep the image unmirrored at capture, for both cameras, so the
        // model sees the real scene and labels left/right anatomically. Re-applied on every switch.
        // Mirroring is set before rotation: toggling mirroring after rotating can flip the rotated buffer.
        if let connection = output.connection(with: .video) {
            if connection.isVideoMirroringSupported {
                connection.automaticallyAdjustsVideoMirroring = false
                connection.isVideoMirrored = false
            }
            if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
        }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        let now = CACurrentMediaTime()
        guard now - lastAccepted >= interval, let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        lastAccepted = now
        onFrame?(buffer)
    }
}
