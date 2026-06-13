import { ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { Grain } from './Grain';
import { Vignette } from './Vignette';

interface Props {
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
  lofi?: boolean; // overlays on by default; allow opting out
}

export const Screen = ({
  children,
  scroll = true,
  style,
  lofi = true,
}: Props) => {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.content, style]}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, style]}>{children}</View>
      )}
      {lofi && (
        <>
          <Vignette />
          <Grain />
        </>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 120,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
});
