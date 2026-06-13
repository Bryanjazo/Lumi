import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../constants/colors';

/**
 * A four-edge soft darkening to push focus toward the screen center.
 * Plus a thin warm tint overlay (~3-5%) to push the whole frame warmer
 * — the lofi "tungsten lamp" feel.
 */
export const Vignette = () => (
  <View pointerEvents="none" style={styles.wrap}>
    <LinearGradient
      colors={['rgba(0,0,0,0.45)', 'transparent']}
      style={[styles.edge, { top: 0, height: 90 }]}
    />
    <LinearGradient
      colors={['transparent', 'rgba(0,0,0,0.6)']}
      style={[styles.edge, { bottom: 0, height: 140 }]}
    />
    <LinearGradient
      colors={['rgba(0,0,0,0.25)', 'transparent']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={[styles.side, { left: 0, width: 30 }]}
    />
    <LinearGradient
      colors={['transparent', 'rgba(0,0,0,0.25)']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={[styles.side, { right: 0, width: 30 }]}
    />
    <View style={[styles.warmth, { backgroundColor: colors.warmth }]} />
  </View>
);

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  edge: { position: 'absolute', left: 0, right: 0 },
  side: { position: 'absolute', top: 0, bottom: 0 },
  warmth: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
