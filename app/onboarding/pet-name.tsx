import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Screen } from '../../components/Screen';
import { LunaHeader } from '../../components/LunaHeader';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { useUserStore } from '../../store/userStore';

export default function PetName() {
  const router = useRouter();
  const setPetName = useUserStore((s) => s.setPetName);
  const [val, setVal] = useState('Luna');

  const submit = () => {
    if (!val.trim()) return;
    Haptics.selectionAsync();
    setPetName(val.trim());
    router.push('/onboarding/first-quest');
  };

  return (
    <Screen>
      <Text style={styles.h2}>Meet your companion.</Text>
      <Text style={styles.sub}>What's her name?</Text>

      <View style={styles.canvasWrap}>
        <LunaHeader state="thriving" height={160} />
      </View>

      <TextInput
        value={val}
        onChangeText={setVal}
        placeholder="Luna"
        placeholderTextColor={colors.text3}
        style={styles.input}
      />
      <Pressable
        onPress={submit}
        disabled={!val.trim()}
        style={[styles.btn, !val.trim() && { opacity: 0.4 }]}
      >
        <Text style={styles.btnText}>That's her</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  h2: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 28,
    marginTop: 20,
  },
  sub: { fontFamily: fonts.sans, color: colors.text2, fontSize: 13, marginTop: 4, marginBottom: 18 },
  canvasWrap: { alignItems: 'center', marginBottom: 18 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border2,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontFamily: fonts.sans,
    color: colors.text,
    fontSize: 17,
    marginBottom: 20,
  },
  btn: {
    backgroundColor: colors.plumDark,
    paddingVertical: 14,
    borderRadius: 100,
    alignItems: 'center',
  },
  btnText: { fontFamily: fonts.sansSemi, color: '#fff', fontSize: 14 },
});
