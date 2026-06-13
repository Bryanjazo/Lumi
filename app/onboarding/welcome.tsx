import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Screen } from '../../components/Screen';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';

export default function Welcome() {
  const router = useRouter();
  return (
    <Screen scroll={false} style={styles.center}>
      <View style={styles.mark}>
        <Text style={styles.markText}>◐</Text>
      </View>
      <Text style={styles.brand}>Lumi</Text>
      <Text style={styles.h1}>
        Your brain works <Text style={styles.italic}>differently.</Text>{'\n'}
        That's not a problem.
      </Text>
      <Text style={styles.p}>
        Lumi is a companion app that meets you where you actually are. No guilt.
        No streaks shaming you. A cat named Luna lives here with you.
      </Text>
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          router.push('/onboarding/name');
        }}
        style={styles.btn}
      >
        <Text style={styles.btnText}>Begin</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center' },
  mark: {
    width: 70,
    height: 70,
    borderRadius: 20,
    backgroundColor: colors.plumBg,
    borderColor: colors.plumBorder,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 18,
  },
  markText: { color: colors.plum, fontSize: 38, lineHeight: 42 },
  brand: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 34,
    textAlign: 'center',
    marginBottom: 28,
  },
  h1: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 26,
    lineHeight: 34,
    textAlign: 'center',
    marginBottom: 14,
  },
  italic: { fontFamily: fonts.serifItalic, color: colors.cream },
  p: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 32,
    paddingHorizontal: 14,
  },
  btn: {
    backgroundColor: colors.plumDark,
    paddingVertical: 14,
    borderRadius: 100,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  btnText: {
    fontFamily: fonts.sansSemi,
    color: '#fff',
    fontSize: 14,
    letterSpacing: 0.5,
  },
});
