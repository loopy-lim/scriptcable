Pod::Spec.new do |s|
  s.name         = "ScriptcaReactNative"
  s.version      = "0.1.0"
  s.summary      = "scriptca native host for React Native"
  s.license      = "MIT"
  s.authors      = "loopy"
  s.homepage     = "https://github.com/loopy-lim/scriptca"
  s.source       = { :git => "https://github.com/loopy-lim/scriptca.git", :tag => s.version.to_s }
  s.platforms    = { :ios => "15.0" }
  s.source_files = "cpp/*.{h,cpp}", "ios/**/*.{h,mm,m}"
  s.pod_target_xcconfig = {
    "HEADER_SEARCH_PATHS" => "\"$(PODS_TARGET_SRCROOT)/cpp\"",
    "OTHER_LDFLAGS" => "-lcalculator -L${SCRIPTCA_LIB_DIR}"
  }
  s.requires_arc = true
end
