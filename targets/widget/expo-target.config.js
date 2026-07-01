/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'widget',
  // Display name shown in the iOS widget gallery.
  // No dash — @bacons/apple-targets writes this verbatim as the
  // Xcode target name in project.pbxproj. EAS Build's widget step
  // looks for target 'lumimood' (the sanitized form), and the
  // earlier 'lumi-mood' caused: "Could not find target 'lumimood'
  // in project.pbxproj". Keep them aligned.
  name: 'lumimood',
  // Bundle id suffix — final id is app.lumi.ios.lumi-mood.
  // KEEP THE DASH: EAS already provisioned credentials + a
  // distribution profile against the dashed bundle. Switching to
  // ".lumimood" would orphan those and force a re-provision.
  // The internal Xcode target name is still 'lumimood' (the
  // plugin sanitizes non-word chars from `name`), so EAS Build's
  // target lookup keeps working.
  bundleIdentifier: '.lumi-mood',
  // Min deployment target. Lumi targets iOS 15+ (matches main app)
  // and WidgetKit's containerBackground API is iOS 17+, so we set 17
  // and degrade gracefully below if needed.
  deploymentTarget: '17.0',
  // ActivityKit needed for the per-task Live Activity that lives in
  // this same extension (LumiTaskLiveActivity).
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit'],
  // Share an App Group with the main app so the widget can read the
  // mood + completedToday count the JS side writes through
  // ExtensionStorage.
  entitlements: {
    'com.apple.security.application-groups': ['group.app.lumi.ios'],
  },
  // PNG frames extracted from the four mood GIFs — Apple Asset
  // Catalog handles these at build time. Loaded in Swift via
  // UIImage(named: "luna-idle") etc.
  images: {
    'luna-idle': './assets/luna-idle.png',
    'luna-happy': './assets/luna-happy.png',
    'luna-sad': './assets/luna-sad.png',
    'luna-sleep': './assets/luna-sleep.png',
    // Full 20-frame licking cycle extracted from luna-lick.gif —
    // Live Activities can't render animated GIFs, so the widget
    // cycles through these PNGs via TimelineView.periodic during
    // focus sessions (see LunaSpriteView in index.swift). 20
    // frames × ~10fps = ~2s cycle, matching the source GIF's
    // native rhythm.
    'luna-lick-1': './assets/luna-lick-1.png',
    'luna-lick-2': './assets/luna-lick-2.png',
    'luna-lick-3': './assets/luna-lick-3.png',
    'luna-lick-4': './assets/luna-lick-4.png',
    'luna-lick-5': './assets/luna-lick-5.png',
    'luna-lick-6': './assets/luna-lick-6.png',
    'luna-lick-7': './assets/luna-lick-7.png',
    'luna-lick-8': './assets/luna-lick-8.png',
    'luna-lick-9': './assets/luna-lick-9.png',
    'luna-lick-10': './assets/luna-lick-10.png',
    'luna-lick-11': './assets/luna-lick-11.png',
    'luna-lick-12': './assets/luna-lick-12.png',
    'luna-lick-13': './assets/luna-lick-13.png',
    'luna-lick-14': './assets/luna-lick-14.png',
    'luna-lick-15': './assets/luna-lick-15.png',
    'luna-lick-16': './assets/luna-lick-16.png',
    'luna-lick-17': './assets/luna-lick-17.png',
    'luna-lick-18': './assets/luna-lick-18.png',
    'luna-lick-19': './assets/luna-lick-19.png',
    'luna-lick-20': './assets/luna-lick-20.png',
  },
  // Widget tint when iOS renders in dimmed / standby modes.
  colors: {
    $accent: '#C49A6A',
    $widgetBackground: '#141210',
  },
};
