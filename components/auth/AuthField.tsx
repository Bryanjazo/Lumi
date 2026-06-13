import { useState } from 'react';
import {
  View,
  TextInput,
  Text,
  Pressable,
  StyleSheet,
  KeyboardTypeOptions,
  TextInputProps,
} from 'react-native';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';

interface Props {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  error?: string;
  note?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  editable?: boolean;
  onSubmitEditing?: () => void;
  returnKeyType?: TextInputProps['returnKeyType'];
}

export const AuthField = ({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  error,
  note,
  keyboardType = 'default',
  autoCapitalize = 'none',
  autoComplete,
  textContentType,
  editable = true,
  onSubmitEditing,
  returnKeyType,
}: Props) => {
  const [focused, setFocused] = useState(false);
  const [showPass, setShowPass] = useState(false);

  return (
    <View style={styles.wrap}>
      <Text
        style={[
          styles.label,
          focused && { color: colors.terra },
          error && { color: colors.err },
        ]}
      >
        {label}
      </Text>
      <View
        style={[
          styles.inputWrap,
          focused && styles.focused,
          error && styles.error,
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.text3}
          secureTextEntry={secureTextEntry && !showPass}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          textContentType={textContentType}
          autoCorrect={false}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
          style={[
            styles.input,
            secureTextEntry && { paddingRight: 48 },
          ]}
        />
        {secureTextEntry && (
          <Pressable
            style={styles.eye}
            onPress={() => setShowPass((s) => !s)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.eyeIcon}>{showPass ? '🙈' : '👁️'}</Text>
          </Pressable>
        )}
      </View>
      {error ? (
        <Text style={styles.errText}>{error}</Text>
      ) : note ? (
        <Text style={styles.note}>{note}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: {
    fontFamily: fonts.sansSemi,
    fontSize: 11,
    letterSpacing: 0.5,
    color: colors.text3,
    marginBottom: 7,
    textTransform: 'uppercase',
  },
  inputWrap: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  focused: { borderColor: colors.terraDark },
  error: {
    borderColor: colors.err,
    backgroundColor: colors.errBg,
  },
  input: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.text,
  },
  eye: {
    padding: 12,
    position: 'absolute',
    right: 0,
  },
  eyeIcon: { fontSize: 16, opacity: 0.5 },
  errText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.err,
    marginTop: 5,
  },
  note: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.text3,
    marginTop: 5,
  },
});
