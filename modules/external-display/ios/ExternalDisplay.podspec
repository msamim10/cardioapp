Pod::Spec.new do |s|
  s.name           = 'ExternalDisplay'
  s.version        = '1.0.0'
  s.summary        = 'External display (AirPlay screen mirroring / wired / AirPlay route) detection for CardioSurf'
  s.description    = 'Reports whether a second UIScreen is attached or an AirPlay audio route is selected, and emits change events.'
  s.author         = 'CardioSurf'
  s.homepage       = 'https://cardiosurf.app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'UIKit', 'AVFoundation'
  s.source_files = '**/*.{h,m,mm,swift}'
end
