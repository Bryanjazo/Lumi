import { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Screen } from '../../components/Screen';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import { useUserStore } from '../../store/userStore';

export default function NameScreen() {
  const router = useRouter();
  const setName = useUserStore((s) => s.setName);
  const [val, setVal] = useState('');

  const submit = () => {
    if (!val.trim()) return;
    Haptics.selectionAsync();
    setName(val.trim());
    router.push('/onboarding/quiz');
  };

  return (
    <Screen scroll={false}>
      <View style={{ marginTop: 40 }}>
        <Text style={styles.h2}>What should we call you?</Text>
        <Text style={styles.sub}>
          First name's fine. We never share it.
        </Text>
        <TextInput
          value={val}
          onChangeText={setVal}
          placeholder="your name"
          placeholderTextColor={colors.text3}
          style={styles.input}
          autoFocus
        />
        <Pressable
          onPress={submit}
          disabled={!val.trim()}
          style={[styles.btn, !val.trim() && { opacity: 0.4 }]}
        >
          <Text style={styles.btnText}>Continue</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  h2: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 28,
    marginBottom: 6,
  },
  sub: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    marginBottom: 24,
  },
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
    marginBottom: 22,
  },
  btn: {
    backgroundColor: colors.plumDark,
    paddingVertical: 14,
    borderRadius: 100,
    alignItems: 'center',
  },
  btnText: {
    fontFamily: fonts.sansSemi,
    color: '#fff',
    fontSize: 14,
  },
});
