import { Pressable, Text, View, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '../constants/colors';
import { fonts } from '../constants/fonts';
import { Mood, moodEmoji, moodList } from '../store/checkinStore';

interface Props {
  selected: Mood | null;
  onSelect: (m: Mood) => void;
}

export const MoodGrid = ({ selected, onSelect }: Props) => {
  return (
    <View style={styles.grid}>
      {moodList.map((m) => {
        const sel = selected === m;
        return (
          <Pressable
            key={m}
            onPress={() => {
              Haptics.selectionAsync();
              onSelect(m);
            }}
            style={[styles.btn, sel && styles.sel]}
          >
            <Text style={styles.emoji}>{moodEmoji[m]}</Text>
            <Text style={[styles.label, sel && styles.labelSel]}>{m}</Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  btn: {
    flexBasis: '23%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 13,
    paddingVertical: 12,
    paddingHorizontal: 5,
    alignItems: 'center',
  },
  sel: {
    borderColor: 'rgba(196,160,224,0.45)',
    backgroundColor: colors.plumBg,
  },
  emoji: { fontSize: 20, marginBottom: 4 },
  label: {
    fontFamily: fonts.sansMedium,
    color: colors.text3,
    fontSize: 10,
  },
  labelSel: { color: colors.plum },
});
