import { View, Text, StyleSheet } from 'react-native';
import { accent, AccentKey } from '../constants/colors';
import { fonts } from '../constants/fonts';

interface Props {
  tone?: AccentKey;
  children: React.ReactNode;
}

export const Pill = ({ tone = 'plum', children }: Props) => {
  const t = accent(tone);
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: t.bg, borderColor: t.border },
      ]}
    >
      <Text style={[styles.text, { color: t.fg }]}>{children}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 100,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  text: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
  },
});
