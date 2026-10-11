import Foundation
import AVFoundation
import ImageIO
import UniformTypeIdentifiers
let b="/Users/brayden/Downloads/KnightHacks2026/pitch/.build/3d/"
for (name,frames) in [("phone-entrance",155),("model-zoom",116)] {
 let a=AVURLAsset(url:URL(fileURLWithPath:b+name+".mp4"))
 let gen=AVAssetImageGenerator(asset:a)
 gen.requestedTimeToleranceBefore = .zero
 gen.requestedTimeToleranceAfter = .zero
 let dest=CGImageDestinationCreateWithURL(URL(fileURLWithPath:b+name+".gif") as CFURL,UTType.gif.identifier as CFString,(frames+1)/2,nil)!
 // No loop extension: play one cycle and retain the last frame.
 for f in stride(from:0,to:frames,by:2) {
  let im=try gen.copyCGImage(at:CMTime(value:Int64(f),timescale:60),actualTime:nil)
  CGImageDestinationAddImage(dest,im,[kCGImagePropertyGIFDictionary:[kCGImagePropertyGIFDelayTime:1.0/30.0,kCGImagePropertyGIFUnclampedDelayTime:1.0/30.0]] as CFDictionary)
 }
 if !CGImageDestinationFinalize(dest){fatalError("GIF export failed")}
 print("Encoded",name)
}
