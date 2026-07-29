Pod::Spec.new do |s|
  s.name           = 'CardioSurfPose'
  s.version        = '1.0.0'
  s.summary        = 'On-device Apple Vision body pose camera for CardioSurf'
  s.description    = 'An Expo native view backed by AVFoundation and VNDetectHumanBodyPoseRequest.'
  s.author         = 'CardioSurf'
  s.homepage       = 'https://cardiosurf.app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'Vision'
  s.source_files = '**/*.{h,m,mm,swift}'
end
