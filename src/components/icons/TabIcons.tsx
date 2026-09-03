/**
 * The three guest tab-bar icons, transcribed verbatim from the design canvas.
 *
 * The canvas draws them as raw inline SVG at 26x26, viewBox 0 0 24 24,
 * fill="none", stroke="currentColor", stroke-width="1.8". Substituting
 * @expo/vector-icons would change the silhouette for no gain -- react-native-svg
 * renders these paths exactly, so fidelity is free here.
 */
import Svg, { Circle, Path } from 'react-native-svg';

import { tabBar } from '@/theme';

export interface TabIconProps {
  color: string;
  size?: number;
}

const common = (color: string, size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: color,
  strokeWidth: tabBar.iconStroke,
});

export function ChatIcon({ color, size = tabBar.iconSize }: TabIconProps) {
  return (
    <Svg {...common(color, size)}>
      <Path d="M4 5h16v11H8l-4 4z" />
    </Svg>
  );
}

export function PhotosIcon({ color, size = tabBar.iconSize }: TabIconProps) {
  return (
    <Svg {...common(color, size)}>
      <Path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <Circle cx="12" cy="13" r="3.5" />
    </Svg>
  );
}

export function MusicIcon({ color, size = tabBar.iconSize }: TabIconProps) {
  return (
    <Svg {...common(color, size)}>
      <Path d="M9 18V6l10-2v12" />
      <Circle cx="6.5" cy="18" r="2.5" />
      <Circle cx="16.5" cy="16" r="2.5" />
    </Svg>
  );
}
