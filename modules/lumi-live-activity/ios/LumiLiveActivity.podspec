Pod::Spec.new do |s|
  s.name           = 'LumiLiveActivity'
  s.version        = '0.1.0'
  s.summary        = 'Lumi per-task Live Activity bridge'
  s.description    = 'Wraps ActivityKit to start / update / end the Lumi task Live Activity from React Native.'
  s.author         = ''
  s.homepage       = 'https://lumi.app'
  s.platforms      = { :ios => '16.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/ObjC files
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'

  # Inherit the main app's Swift compiler settings
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
