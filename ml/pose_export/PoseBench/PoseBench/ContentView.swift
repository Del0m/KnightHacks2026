import AVFoundation
import PoseCore
import SwiftUI

struct ContentView: View {
    @StateObject private var model = PoseBenchModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if model.availableSizes.isEmpty {
                MessageView(title: "No models found", message: model.errorMessage ?? "Run `uv run export.py` first.")
            } else if model.cameraDenied {
                MessageView(title: "Camera access needed",
                            message: "PoseBench needs the camera to test the pose model. Video never leaves the phone.",
                            action: ("Open Settings", {
                                if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                            }))
            } else {
                live
            }
        }
        .preferredColorScheme(.dark)
        .task { await model.start() }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { model.cancelBenchmark() }
        }
    }

    private var live: some View {
        ZStack {
            // Preview and overlay share one frame so OverlayGeometry's aspect-fit math lines up.
            ZStack {
                CameraPreview(session: model.camera.session)
                SkeletonOverlay(pose: model.pose, imageSize: model.frameSize, mirrored: model.cameraPosition == .front)
            }
            .ignoresSafeArea()

            VStack(spacing: 12) {
                readout
                Spacer()
                if let error = model.errorMessage {
                    Text(error).font(.footnote).foregroundStyle(.yellow).multilineTextAlignment(.center)
                }
                controls
            }
            .padding()
        }
    }

    private var readout: some View {
        VStack(spacing: 4) {
            HStack(spacing: 16) {
                Text("\(model.size) px")
                Text(model.latencyMs.map { String(format: "%.1f ms", $0) } ?? "– ms")
                Text(String(format: "%.0f fps", model.fps))
            }
            .font(.system(.headline, design: .monospaced))
            if model.pose == nil {
                Text("no person").font(.subheadline).foregroundStyle(.orange)
            }
            if let status = model.benchmarkStatus {
                Text(status).font(.subheadline).foregroundStyle(.cyan)
            }
        }
        .padding(10)
        .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
        .foregroundStyle(.white)
    }

    private var controls: some View {
        VStack(spacing: 10) {
            HStack {
                Picker("Model size", selection: $model.size) {
                    ForEach(PoseBenchModel.sizes, id: \.self) { size in
                        Text("\(size)").tag(size)
                            .selectionDisabled(!model.availableSizes.contains(size))
                    }
                }
                .pickerStyle(.segmented)
                .disabled(model.isBenchmarking)

                Button {
                    model.cameraPosition = model.cameraPosition == .front ? .back : .front
                } label: {
                    Image(systemName: "arrow.triangle.2.circlepath.camera").font(.title2)
                }
                .accessibilityLabel("Switch camera")
                .disabled(model.isBenchmarking)
            }
            HStack {
                Button(model.isBenchmarking ? "Running…" : "Run benchmark") { model.runBenchmark() }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.isBenchmarking)
                Button("Copy row") { model.copyRows() }
                    .buttonStyle(.bordered)
                    .disabled(model.rows.isEmpty)
            }
        }
        .padding(10)
        .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
    }
}

private struct MessageView: View {
    let title: String
    let message: String
    var action: (String, () -> Void)?

    var body: some View {
        VStack(spacing: 16) {
            Text(title).font(.title2.bold())
            Text(message).multilineTextAlignment(.center).foregroundStyle(.secondary)
            if let action {
                Button(action.0, action: action.1).buttonStyle(.borderedProminent)
            }
        }
        .padding(32)
        .foregroundStyle(.white)
    }
}

private struct SkeletonOverlay: View {
    let pose: PoseResult?
    let imageSize: CGSize
    let mirrored: Bool
    private let minJointConfidence: Float = 0.3

    var body: some View {
        Canvas { context, size in
            guard let pose else { return }
            let points = pose.joints.map {
                OverlayGeometry.point($0, imageSize: imageSize, viewSize: size, mirrored: mirrored)
            }
            let visible = pose.joints.map { $0.c >= minJointConfidence }
            var bones = Path()
            for (a, b) in OverlayGeometry.bones where visible[a] && visible[b] {
                bones.move(to: points[a])
                bones.addLine(to: points[b])
            }
            context.stroke(bones, with: .color(.green), lineWidth: 3)
            for (point, isVisible) in zip(points, visible) where isVisible {
                context.fill(Path(ellipseIn: CGRect(x: point.x - 5, y: point.y - 5, width: 10, height: 10)),
                             with: .color(.white))
            }
        }
        .allowsHitTesting(false)
    }
}

private struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspect // aspect-fit, matching OverlayGeometry
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}
