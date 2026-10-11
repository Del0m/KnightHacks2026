require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "SteadyForumPose"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => '17.0' }
  s.source       = { :path => "." }

  s.source_files = [
    # Implementation (Swift)
    "ios/**/*.{swift}",
  ]
  s.frameworks = ["Vision", "CoreML", "AVFoundation"]

  load 'nitrogen/generated/ios/SteadyForumPose+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'VisionCamera'
  s.dependency 'NitroModules'
  s.dependency 'PoseCore'
  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
