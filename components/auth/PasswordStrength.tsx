import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';

interface Props {
  password: string;
}

export const PasswordStrength = ({ password }: Props) => {
  if (!password) return null;

  const checks = [
    { label: '8+ chars', ok: password.length >= 8 },
    { label: 'Uppercase', ok: /[A-Z]/.test(password) },
    { label: 'Number', ok: /[0-9]/.test(password) },
  ];
  const score = checks.filter((c) => c.ok).length;
  const barColor = ['', colors.err, colors.caramel, colors.moss][score];

  return (
    <View style={styles.wrap}>
      <View style={styles.bars}>
        {[1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.bar,
              { backgroundColor: i <= score ? barColor : colors.border },
            ]}
          />
        ))}
      </View>
      <View style={styles.checks}>
        {checks.map((c) => (
          <Text
            key={c.label}
            style={[styles.check, c.ok && { color: colors.moss }]}
          >
            {c.ok ? '✓ ' : '○ '}
            {c.label}
          </Text>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  bars: { flexDirection: 'row', gap: 5, marginBottom: 7 },
  bar: { flex: 1, height: 3, borderRadius: 3 },
  checks: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  check: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.text3,
  },
});
