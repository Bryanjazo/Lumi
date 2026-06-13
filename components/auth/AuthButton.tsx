import {
  Pressable,
  Text,
  View,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';

type Variant = 'primary' | 'ghost' | 'social';

interface Props {
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: Variant;
  icon?: string;
}

const VARIANTS: Record<
  Variant,
  { bg: string; text: string; border: string | null }
> = {
  primary: { bg: colors.terraDark, text: '#fff', border: null },
  ghost: { bg: 'transparent', text: colors.text3, border: null },
  social: { bg: colors.card, text: colors.text, border: colors.border },
};

export const AuthButton = ({
  children,
  onPress,
  disabled,
  loading,
  variant = 'primary',
  icon,
}: Props) => {
  const v = VARIANTS[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: v.bg,
          borderWidth: v.border ? 1 : 0,
          borderColor: v.border ?? 'transparent',
        },
        (disabled || loading) && styles.disabled,
        variant === 'ghost' && styles.ghost,
        pressed && !disabled && !loading && { opacity: 0.78 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.text} size="small" />
      ) : (
        <View style={styles.row}>
          {icon && <Text style={styles.icon}>{icon}</Text>}
          <Text
            style={[
              styles.label,
              { color: v.text },
              variant === 'ghost' && styles.ghostLabel,
            ]}
          >
            {children}
          </Text>
        </View>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  btn: {
    borderRadius: 13,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginBottom: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  disabled: { opacity: 0.38 },
  ghost: { paddingVertical: 10, marginBottom: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { fontSize: 17 },
  label: {
    fontFamily: fonts.sansSemi,
    fontSize: 15,
    letterSpacing: 0.1,
  },
  ghostLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
  },
});
