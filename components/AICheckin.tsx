import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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
      <View style={styles.loadingCard}>
        <ActivityIndicator color={colors.plum} />
        <Text style={styles.loading}>Reading the room…</Text>
      </View>
    );
  }
  if (!response) return null;
  return (
    <LinearGradient
      colors={[colors.surface, '#221A2A']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <View style={styles.eyebrow}>
        <View style={styles.dot} />
        <Text style={styles.eyebrowText}>Lumi understands this</Text>
      </View>

      <View style={styles.statePill}>
        <Text style={styles.stateText}>{response.state}</Text>
      </View>

      <Text style={styles.body}>{response.explanation}</Text>

      <View style={styles.actionBox}>
        <Text style={styles.actionLabel}>One thing right now</Text>
        <Text style={styles.actionText}>{response.action}</Text>
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 15,
    padding: 17,
    paddingHorizontal: 19,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  loadingCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border2,
    borderRadius: 15,
    padding: 18,
    alignItems: 'center',
    gap: 10,
  },
  loading: {
    fontFamily: fonts.sansItalic,
    color: colors.text3,
    fontSize: 12,
  },
  eyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 11,
  },
  dot: {
    width: 6,
    height: 6,
    backgroundColor: colors.plum,
    borderRadius: 100,
  },
  eyebrowText: {
    fontFamily: fonts.sansSemi,
    color: colors.plum,
    fontSize: 11,
  },
  statePill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.terraBg,
    borderColor: colors.terraBorderStrong,
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 11,
    paddingVertical: 4,
    marginBottom: 12,
  },
  stateText: {
    fontFamily: fonts.sansSemi,
    color: colors.terra,
    fontSize: 12,
  },
  body: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    lineHeight: 22,
    marginBottom: 14,
  },
  actionBox: {
    backgroundColor: colors.mossBg,
    borderColor: 'rgba(139,191,150,0.15)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 13,
    paddingHorizontal: 15,
  },
  actionLabel: {
    fontFamily: fonts.sansSemi,
    color: colors.moss,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  actionText: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    lineHeight: 20,
  },
});
