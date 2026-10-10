import AVFoundation
import OSLog
import QuartzCore

/// Delivers upright, unmirrored camera frames on a serial queue, dropping frames that arrive
/// sooner than `minFrameInterval` after the last accepted one (dropped, never queued, so the
/// skeleton never lags behind the body).
final class CameraFeed: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    let session = AVCaptureSession()
    /// Called on the camera queue.
    var onFrame: ((CVPixelBuffer) -> Void)?
    /// Called on the camera queue after the session is (re)configured, with the rotation angle the
    /// preview layer's connection needs. A camera switch rebuilds that connection.
    var onReconfigure: ((CGFloat) -> Void)?
    /// The on-screen preview layer. Set before `start()`; the rotation coordinator needs it.
    weak var previewLayer: AVCaptureVideoPreviewLayer?

    var position: AVCaptureDevice.Position = .front {
        didSet { queue.async { self.reconfigure() } }
    }

    /// Set from any thread; read on the camera queue.
    var minFrameInterval: TimeInterval {
        get { queue.sync { interval } }
        set { queue.async { self.interval = newValue } }
    }

    private let queue = DispatchQueue(label: "posebench.camera")
    private let output = AVCaptureVideoDataOutput()
    private let log = Logger(subsystem: "com.del0m.posebench", category: "camera")
    private var interval: TimeInterval = 1.0 / 15
    private var lastAccepted: CFTimeInterval = 0
    private var rotation: AVCaptureDevice.RotationCoordinator?
    private var loggedFrameSize = false

    func start() {
        queue.async {
            self.reconfigure()
            self.session.startRunning()
        }
    }

    private func reconfigure() {
        let previewAngle = configure()
        if let previewAngle { onReconfigure?(previewAngle) }
    }

    /// Returns the preview layer's rotation angle, or nil if no camera could be set up.
    private func configure() -> CGFloat? {
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = .hd1280x720
        session.inputs.forEach(session.removeInput)
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else { return nil }
        session.addInput(input)

        if !session.outputs.contains(output), session.canAddOutput(output) {
            output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
            output.alwaysDiscardsLateVideoFrames = true
            output.setSampleBufferDelegate(self, queue: queue)
            session.addOutput(output)
        }

        // Each camera is mounted at its own angle (e.g. the iPhone 17's square front sensor differs
        // from older phones), so the angles come from Apple's rotation coordinator, never a constant.
        let coordinator = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: previewLayer)
        rotation = coordinator
        let captureAngle = coordinator.videoRotationAngleForHorizonLevelCapture
        let previewAngle = coordinator.videoRotationAngleForHorizonLevelPreview

        // Keep the frames the model sees upright and unmirrored, so it labels left/right
        // anatomically. Mirroring is set before rotation: toggling it after rotating can flip the buffer.
        if let connection = output.connection(with: .video) {
            if connection.isVideoMirroringSupported {
                connection.automaticallyAdjustsVideoMirroring = false
                connection.isVideoMirrored = false
            }
            if connection.isVideoRotationAngleSupported(captureAngle) {
                connection.videoRotationAngle = captureAngle
            }
        }
        loggedFrameSize = false
        log.info("""
            \(self.position == .front ? "front" : "back", privacy: .public) camera \
            \(device.localizedName, privacy: .public): capture angle \(captureAngle), preview angle \(previewAngle)
            """)
        return previewAngle
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        let now = CACurrentMediaTime()
        guard now - lastAccepted >= interval, let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        lastAccepted = now
        if !loggedFrameSize {
            loggedFrameSize = true
            log.info("frame \(CVPixelBufferGetWidth(buffer))×\(CVPixelBufferGetHeight(buffer)) (portrait = width < height)")
        }
        onFrame?(buffer)
    }
}
