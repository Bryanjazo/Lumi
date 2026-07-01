// LunaPixel — animated cat sprite used on auth screens.
//
// Backed by the shared `lunaSource(mood)` helper so this surface
// matches every other Luna instance in the app. The `mood` prop is
// honored: 'happy' on the sign-up greeting, 'idle' elsewhere.

import { Image, StyleSheet, View } from 'react-native';
import { lunaSource, useLunaSkin, type LunaMood as SharedMood } from '../../lib/luna-source';

// Kept as a superset of SharedMood for back-compat with callers that
// previously asked for 'excited' (treated as happy below).
export type LunaMood = SharedMood | 'excited';

interface Props {
  mood?: LunaMood;
  size?: number;
}

const normalize = (m: LunaMood): SharedMood =>
  m === 'excited' ? 'happy' : m;

export const LunaPixel = ({ mood = 'idle', size = 110 }: Props) => {
  const lunaSkin = useLunaSkin();
  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Image
        source={lunaSource(normalize(mood), lunaSkin)}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
