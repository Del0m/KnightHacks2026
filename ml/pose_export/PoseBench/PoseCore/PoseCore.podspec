Pod::Spec.new do |s|
  s.name          = 'PoseCore'
  s.version       = '0.1.0'
  s.summary       = 'On-device YOLOv8n-pose inference, decoding and orientation helpers.'
  s.homepage      = 'https://github.com/Del0m/KnightHacks2026'
  s.license       = { :type => 'AGPL-3.0' }
  s.authors       = 'Del0m'
  s.platforms     = { :ios => '17.0' }
  s.swift_version = '5.10'
  s.source        = { :path => '.' }
  s.source_files  = 'Sources/PoseCore/**/*.swift'
  s.frameworks    = ['CoreML', 'CoreVideo', 'QuartzCore', 'ImageIO']
end
