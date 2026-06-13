import { View, StyleSheet } from 'react-native';
import { colors } from '../../constants/colors';

export type LunaMood = 'idle' | 'happy' | 'excited' | 'sleep';

interface Props {
  mood?: LunaMood;
  size?: number;
}

/**
 * Round kawaii Luna portrait used on the auth screens. Built from
 * positioned Views (no SVG / no canvas) so it animates cheaply and stays
 * crisp at any size.
 */
export const LunaPixel = ({ mood = 'idle', size = 120 }: Props) => {
  const headSize = Math.round(size * 0.43);
  const headLeft = (size - headSize) / 2;
  const eyeSize = Math.round(size * 0.12);
  const earSize = Math.round(size * 0.14);
  const bodyW = Math.round(size * 0.37);
  const bodyH = Math.round(size * 0.32);
  const bodyLeft = (size - bodyW) / 2;
  const noseW = Math.round(size * 0.067);
  const noseH = Math.round(size * 0.042);

  const smiling = mood === 'happy' || mood === 'excited';
  const sleeping = mood === 'sleep';

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      {/* head */}
      <View
        style={[
          styles.head,
          {
            width: headSize,
            height: Math.round(headSize * 0.88),
            borderRadius: headSize / 2,
            top: Math.round(size * 0.08),
            left: headLeft,
          },
        ]}
      />

      {/* ears */}
      <View
        style={[
          styles.ear,
          {
            width: earSize,
            height: Math.round(earSize * 1.13),
            borderRadius: earSize / 2,
            top: Math.round(size * 0.033),
            left: headLeft + Math.round(size * 0.033),
          },
        ]}
      >
        <View style={styles.earInner} />
      </View>
      <View
        style={[
          styles.ear,
          {
            width: earSize,
            height: Math.round(earSize * 1.13),
            borderRadius: earSize / 2,
            top: Math.round(size * 0.033),
            right: headLeft + Math.round(size * 0.033),
          },
        ]}
      >
        <View style={styles.earInner} />
      </View>

      {/* eyes */}
      {sleeping ? (
        <>
          <View
            style={[
              styles.sleepEye,
              {
                width: Math.round(size * 0.1),
                top: Math.round(size * 0.22),
                left: headLeft + Math.round(size * 0.067),
              },
            ]}
          />
          <View
            style={[
              styles.sleepEye,
              {
                width: Math.round(size * 0.1),
                top: Math.round(size * 0.22),
                right: headLeft + Math.round(size * 0.067),
              },
            ]}
          />
        </>
      ) : (
        <>
          <View
            style={[
              styles.eye,
              {
                width: eyeSize,
                height: eyeSize,
                borderRadius: eyeSize / 2,
                top: Math.round(size * 0.22),
                left: headLeft + Math.round(size * 0.067),
              },
            ]}
          >
            <View style={styles.pupil} />
            <View style={styles.shine} />
          </View>
          <View
            style={[
              styles.eye,
              {
                width: eyeSize,
                height: eyeSize,
                borderRadius: eyeSize / 2,
                top: Math.round(size * 0.22),
                right: headLeft + Math.round(size * 0.067),
              },
            ]}
          >
            <View style={styles.pupil} />
            <View style={styles.shine} />
          </View>
        </>
      )}

      {/* nose */}
      <View
        style={[
          styles.nose,
          {
            width: noseW,
            height: noseH,
            top: Math.round(size * 0.35),
            left: size / 2 - noseW / 2,
          },
        ]}
      />

      {/* mouth */}
      {smiling ? (
        <View
          style={[
            styles.smile,
            {
              width: Math.round(size * 0.15),
              height: Math.round(size * 0.067),
              top: Math.round(size * 0.4),
              left: size / 2 - Math.round(size * 0.075),
            },
          ]}
        />
      ) : (
        <View
          style={[
            styles.neutral,
            {
              width: Math.round(size * 0.1),
              top: Math.round(size * 0.425),
              left: size / 2 - Math.round(size * 0.05),
            },
          ]}
        />
      )}

      {/* body */}
      <View
        style={[
          styles.body,
          {
            width: bodyW,
            height: bodyH,
            borderRadius: bodyW / 2,
            bottom: Math.round(size * 0.033),
            left: bodyLeft,
          },
        ]}
      >
        <View
          style={[
            styles.belly,
            {
              width: Math.round(bodyW * 0.59),
              height: Math.round(bodyH * 0.58),
              borderRadius: bodyW / 2,
            },
          ]}
        />
      </View>
    </View>
  );
};

const STROKE = '#0E0A14';

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  head: {
    position: 'absolute',
    backgroundColor: colors.cream,
    borderWidth: 2,
    borderColor: STROKE,
  },
  ear: {
    position: 'absolute',
    backgroundColor: colors.cream,
    borderWidth: 2,
    borderColor: STROKE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  earInner: {
    width: '50%',
    height: '55%',
    borderRadius: 100,
    backgroundColor: 'rgba(216,136,120,0.55)',
  },
  eye: {
    position: 'absolute',
    backgroundColor: '#9AB4C4',
    borderWidth: 2,
    borderColor: STROKE,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pupil: {
    width: '50%',
    height: '50%',
    borderRadius: 100,
    backgroundColor: STROKE,
    position: 'absolute',
    top: '20%',
    left: '20%',
  },
  shine: {
    width: '28%',
    height: '28%',
    borderRadius: 100,
    backgroundColor: '#fff',
    position: 'absolute',
    top: '12%',
    left: '12%',
  },
  sleepEye: {
    position: 'absolute',
    height: 2,
    borderRadius: 1,
    backgroundColor: STROKE,
  },
  nose: {
    position: 'absolute',
    backgroundColor: colors.rose,
    borderRadius: 3,
  },
  smile: {
    position: 'absolute',
    borderBottomLeftRadius: 100,
    borderBottomRightRadius: 100,
    borderWidth: 2,
    borderColor: STROKE,
    borderTopWidth: 0,
    backgroundColor: 'transparent',
  },
  neutral: {
    position: 'absolute',
    height: 2,
    backgroundColor: STROKE,
    borderRadius: 1,
  },
  body: {
    position: 'absolute',
    backgroundColor: colors.cream,
    borderWidth: 2,
    borderColor: STROKE,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 4,
  },
  belly: {
    backgroundColor: '#F5EAD0',
  },
});
