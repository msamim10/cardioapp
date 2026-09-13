Pod::Spec.new do |s|
  s.name           = 'CardioSurfComposer'
  s.version        = '1.0.0'
  s.summary        = 'Post-run share video composer for CardioSurf'
  s.description    = 'Builds the 720x1280 game + camera + HUD share video from a camera clip, the level composite asset and a composition plan, with AVFoundation.'
  s.author         = 'CardioSurf'
  s.homepage       = 'https://cardiosurf.app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'CoreMedia', 'QuartzCore', 'UIKit'
  s.source_files = '**/*.{h,m,mm,swift}'
end
