// MicIcon — shared SVG mic glyph used by every voice-input button
// across the app (Home, Capture, Untangle, Onboarding, Edit-quest
// sheet, profile capture-language row). Replaces the inconsistent
// "🎙" emoji which rendered slightly differently on iOS / Android
// and couldn't take the user's accent color.
//
// Shape: a rounded capsule body with two faint vertical "membrane"
// lines, a U-shaped stand, and a small base. Matches the screenshot
// the user shared in lumi-home-v2 review.

import Svg, { Path, Line } from 'react-native-svg';

interface Props {
  size?: number;
  color: string;
  /** Stroke width — default 1.7. Scale up slightly for larger sizes. */
  strokeWidth?: number;
}

export const MicIcon = ({ size = 18, color, strokeWidth = 1.7 }: Props) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {/* Capsule body */}
    <Path
      d="M12 3.5a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0v-6a3 3 0 0 0-3-3z"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* U-stand */}
    <Path
      d="M6 11v1.5a6 6 0 0 0 12 0V11"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Vertical drop from capsule to base */}
    <Line
      x1={12}
      y1={18.5}
      x2={12}
      y2={21}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
    />
    {/* Base */}
    <Line
      x1={9}
      y1={21}
      x2={15}
      y2={21}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
    />
  </Svg>
);
