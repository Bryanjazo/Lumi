import { Tabs } from 'expo-router';
import { Text, StyleSheet, Platform } from 'react-native';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';

const Icon = ({ ch }: { ch: string }) => (
  <Text style={styles.icon}>{ch}</Text>
);

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 86 : 70,
          paddingTop: 10,
          paddingBottom: Platform.OS === 'ios' ? 28 : 14,
        },
        tabBarActiveTintColor: colors.terra,
        tabBarInactiveTintColor: colors.text3,
        tabBarLabelStyle: {
          fontFamily: fonts.sansSemi,
          fontSize: 9,
          letterSpacing: 0.3,
          textTransform: 'uppercase',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: () => <Icon ch="🏠" /> }}
      />
      <Tabs.Screen
        name="checkin"
        options={{ title: 'Check-in', tabBarIcon: () => <Icon ch="🧠" /> }}
      />
      <Tabs.Screen
        name="time"
        options={{ title: 'Time', tabBarIcon: () => <Icon ch="⏳" /> }}
      />
      <Tabs.Screen
        name="sos"
        options={{ title: 'SOS', tabBarIcon: () => <Icon ch="🆘" /> }}
      />
      <Tabs.Screen
        name="me"
        options={{ title: 'Me', tabBarIcon: () => <Icon ch="✦" /> }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  icon: {
    fontSize: 22,
    lineHeight: 24,
  },
});
