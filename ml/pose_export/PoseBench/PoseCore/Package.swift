// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "PoseCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "PoseCore", targets: ["PoseCore"])],
    targets: [
        .target(name: "PoseCore"),
        .testTarget(name: "PoseCoreTests", dependencies: ["PoseCore"]),
    ]
)
