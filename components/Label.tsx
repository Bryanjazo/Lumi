import { Text, StyleSheet, TextStyle } from 'react-native';
import { colors } from '../constants/colors';
import { fonts } from '../constants/fonts';

export const Label = ({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: TextStyle;
}) => <Text style={[styles.label, style]}>{children}</Text>;

const styles = StyleSheet.create({
  label: {
    fontFamily: fonts.sansSemi,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: colors.text3,
    marginBottom: 11,
  },
});
