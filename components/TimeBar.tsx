import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../constants/colors';
import { fonts } from '../constants/fonts';

interface Props {
  peakStartHour: number;
  peakEndHour: number;
}

const HOURS = 24;

export const TimeBar = ({ peakStartHour, peakEndHour }: Props) => {
  const now = new Date();
  const nowFrac = (now.getHours() + now.getMinutes() / 60) / HOURS;
  const peakStart = peakStartHour / HOURS;
  const peakEnd = peakEndHour / HOURS;

  return (
    <View>
      <View style={styles.bar}>
        <View style={[styles.fillDone, { width: `${nowFrac * 100}%` }]} />
        <View
          style={[
            styles.peak,
            {
              left: `${peakStart * 100}%`,
              width: `${(peakEnd - peakStart) * 100}%`,
            },
          ]}
        />
        <View style={[styles.marker, { left: `${nowFrac * 100}%` }]} />
      </View>
      <View style={styles.legend}>
        <Text style={styles.legendText}>12a</Text>
        <Text style={styles.legendText}>6a</Text>
        <Text style={styles.legendText}>12p</Text>
        <Text style={styles.legendText}>6p</Text>
        <Text style={styles.legendText}>12a</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    height: 22,
    backgroundColor: colors.bg2,
    borderRadius: 100,
    overflow: 'hidden',
    position: 'relative',
  },
  fillDone: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.border2,
    opacity: 0.7,
  },
  peak: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(139,191,150,0.35)',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.moss,
  },
  marker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: colors.plum,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  legendText: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 10,
  },
});
