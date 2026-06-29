/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'widget',
  // Display name shown in the iOS widget gallery.
  name: 'lumi-mood',
  // Bundle id suffix — final id becomes <main>.lumi-mood
  bundleIdentifier: '.lumi-mood',
  // Min deployment target. Lumi targets iOS 15+ (matches main app)
  // and WidgetKit's containerBackground API is iOS 17+, so we set 17
  // and degrade gracefully below if needed.
  deploymentTarget: '17.0',
  frameworks: ['SwiftUI', 'WidgetKit'],
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
  },
  // Widget tint when iOS renders in dimmed / standby modes.
  colors: {
    $accent: '#C49A6A',
    $widgetBackground: '#141210',
  },
};
