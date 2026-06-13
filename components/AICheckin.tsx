import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { colors } from '../constants/colors';
import { fonts } from '../constants/fonts';
import { CheckinResponse } from '../lib/anthropic';

interface Props {
  loading?: boolean;
  response: CheckinResponse | null;
}

export const AICheckin = ({ loading, response }: Props) => {
  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={colors.plum} />
        <Text style={styles.loading}>Reading the room…</Text>
      </View>
    );
  }
  if (!response) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.tag}>WHAT'S HAPPENING</Text>
      <Text style={styles.state}>{response.state}</Text>
      <Text style={styles.explain}>{response.explanation}</Text>
      <View style={styles.actionBox}>
        <Text style={styles.actionLabel}>ONE THING</Text>
        <Text style={styles.action}>{response.action}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border2,
    borderRadius: 15,
    padding: 16,
    marginTop: 14,
  },
  tag: {
    fontFamily: fonts.sansSemi,
    fontSize: 10,
    letterSpacing: 1.6,
    color: colors.text3,
    marginBottom: 8,
  },
  state: {
    fontFamily: fonts.serif,
    fontSize: 19,
    color: colors.cream,
    marginBottom: 10,
    lineHeight: 24,
  },
  explain: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 14,
  },
  actionBox: {
    backgroundColor: colors.plumBg,
    borderColor: colors.plumBorder,
    borderWidth: 1,
    borderRadius: 11,
    padding: 12,
  },
  actionLabel: {
    fontFamily: fonts.sansSemi,
    color: colors.plum,
    fontSize: 10,
    letterSpacing: 1.6,
    marginBottom: 6,
  },
  action: {
    fontFamily: fonts.sansMedium,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  loading: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 12,
    marginTop: 8,
  },
});
