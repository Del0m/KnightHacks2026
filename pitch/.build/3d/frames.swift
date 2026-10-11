import Foundation
import AVFoundation
import AppKit
let b="/Users/brayden/Downloads/KnightHacks2026/pitch/.build/3d/"
let asset=AVURLAsset(url:URL(fileURLWithPath:b+CommandLine.arguments[1]+".mp4"))
let gen=AVAssetImageGenerator(asset:asset)
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero
for t in [0.6,1.2,1.8,2.3] {
 let im=try gen.copyCGImage(at:CMTime(seconds:t,preferredTimescale:600),actualTime:nil)
 let rep=NSBitmapImageRep(cgImage:im)
 try rep.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:b+CommandLine.arguments[1]+"-\(t).png"))
}
print("Extracted video frames")
