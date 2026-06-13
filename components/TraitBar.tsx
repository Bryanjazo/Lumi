import { View, Text, StyleSheet } from 'react-native';
import { colors, accent, AccentKey } from '../constants/colors';
import { fonts } from '../constants/fonts';

interface Props {
  label: string;
  value: number;
  tone: AccentKey;
  note?: string;
}

export const TraitBar = ({ label, value, tone, note }: Props) => {
  const t = accent(tone);
  return (
    <View style={styles.row}>
      <View style={styles.head}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.value, { color: t.fg }]}>{value}</Text>
      </View>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            { width: `${value}%`, backgroundColor: t.fg },
          ]}
        />
      </View>
      {note && <Text style={styles.note}>{note}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { marginBottom: 14 },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: {
    fontFamily: fonts.sansMedium,
    color: colors.text,
    fontSize: 12,
  },
  value: { fontFamily: fonts.sansSemi, fontSize: 12 },
  track: {
    height: 5,
    backgroundColor: colors.bg2,
    borderRadius: 100,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 100 },
  note: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 11,
    marginTop: 4,
  },
});
