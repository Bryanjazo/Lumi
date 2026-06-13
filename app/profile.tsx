import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { colors } from '../constants/colors';
import { fonts } from '../constants/fonts';
import { LunaPixel } from '../components/auth/LunaPixel';
import { AuthField } from '../components/auth/AuthField';
import { AuthButton } from '../components/auth/AuthButton';
import { signOut, useSession } from '../lib/auth';
import { useAccessStatus } from '../lib/subscription';
import { useUserStore } from '../store/userStore';
import {
  scheduleDailyReminders,
  cancelAllReminders,
  requestNotificationPermissions,
} from '../lib/notifications';

export default function ProfileScreen() {
  const router = useRouter();
  const { session } = useSession();
  const access = useAccessStatus(session);

  const name = useUserStore((s) => s.name);
  const petName = useUserStore((s) => s.petName);
  const notificationsEnabled = useUserStore((s) => s.notificationsEnabled);
  const setName = useUserStore((s) => s.setName);
  const setPetName = useUserStore((s) => s.setPetName);
  const setNotificationsEnabled = useUserStore(
    (s) => s.setNotificationsEnabled,
  );

  const [editingName, setEditingName] = useState(false);
  const [editingPet, setEditingPet] = useState(false);
  const [nameDraft, setNameDraft] = useState(name);
  const [petDraft, setPetDraft] = useState(petName);

  const saveName = () => {
    if (!nameDraft.trim()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setName(nameDraft.trim());
    setEditingName(false);
  };

  const savePet = () => {
    if (!petDraft.trim()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPetName(petDraft.trim());
    setEditingPet(false);
  };

  const toggleNotifications = async (on: boolean) => {
    Haptics.selectionAsync();
    if (on) {
      const ok = await requestNotificationPermissions();
      if (!ok) {
        Alert.alert(
          'Notifications blocked',
          'Enable them in iOS Settings → Lumi → Notifications.',
        );
        return;
      }
      await scheduleDailyReminders();
      setNotificationsEnabled(true);
    } else {
      await cancelAllReminders();
      setNotificationsEnabled(false);
    }
  };

  const handleSignOut = async () => {
    Alert.alert('Sign out?', "Your local data stays on this device.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          await signOut();
          // Root layout reroutes when session becomes null.
        },
      },
    ]);
  };

  const trialBadge = access.hasActiveSubscription
    ? { label: '✦ Active subscription', tone: colors.moss }
    : access.inTrial
      ? {
          label: `✦ ${access.trialDaysLeft} ${access.trialDaysLeft === 1 ? 'day' : 'days'} left in trial`,
          tone: colors.caramel,
        }
      : { label: '✦ Trial ended', tone: colors.rose };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Profile</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* hero card */}
        <View style={styles.hero}>
          <LunaPixel mood="happy" size={88} />
          <Text style={styles.heroName}>{name || 'friend'}</Text>
          {session?.user.email && (
            <Text style={styles.heroEmail}>{session.user.email}</Text>
          )}
          <View
            style={[
              styles.badge,
              { borderColor: trialBadge.tone, backgroundColor: 'transparent' },
            ]}
          >
            <Text style={[styles.badgeText, { color: trialBadge.tone }]}>
              {trialBadge.label}
            </Text>
          </View>
        </View>

        {/* Account */}
        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.group}>
          {editingName ? (
            <View style={styles.editRow}>
              <AuthField
                label="Your name"
                value={nameDraft}
                onChangeText={setNameDraft}
                placeholder="First name"
                autoCapitalize="words"
                autoComplete="name"
              />
              <View style={styles.editActions}>
                <Pressable
                  onPress={() => {
                    setEditingName(false);
                    setNameDraft(name);
                  }}
                  style={styles.editCancel}
                >
                  <Text style={styles.editCancelText}>Cancel</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                  <AuthButton onPress={saveName}>Save</AuthButton>
                </View>
              </View>
            </View>
          ) : (
            <Row
              icon="✎"
              label="Name"
              value={name || 'Not set'}
              onPress={() => {
                Haptics.selectionAsync();
                setNameDraft(name);
                setEditingName(true);
              }}
            />
          )}

          {editingPet ? (
            <View style={styles.editRow}>
              <AuthField
                label="Pet name"
                value={petDraft}
                onChangeText={setPetDraft}
                placeholder="Luna"
                autoCapitalize="words"
              />
              <View style={styles.editActions}>
                <Pressable
                  onPress={() => {
                    setEditingPet(false);
                    setPetDraft(petName);
                  }}
                  style={styles.editCancel}
                >
                  <Text style={styles.editCancelText}>Cancel</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                  <AuthButton onPress={savePet}>Save</AuthButton>
                </View>
              </View>
            </View>
          ) : (
            <Row
              icon="🐾"
              label="Pet name"
              value={petName}
              onPress={() => {
                Haptics.selectionAsync();
                setPetDraft(petName);
                setEditingPet(true);
              }}
            />
          )}

          <Row
            icon="✦"
            label="Subscription"
            value={trialBadge.label.replace('✦ ', '')}
            onPress={() => {
              Haptics.selectionAsync();
              router.push('/paywall');
            }}
            last
          />
        </View>

        {/* Preferences */}
        <Text style={styles.sectionLabel}>Preferences</Text>
        <View style={styles.group}>
          <View style={styles.toggleRow}>
            <View style={styles.rowLeft}>
              <Text style={styles.rowIcon}>🔔</Text>
              <View>
                <Text style={styles.rowLabel}>Notifications</Text>
                <Text style={styles.rowValue}>
                  Morning · midday · wind-down
                </Text>
              </View>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={toggleNotifications}
              trackColor={{
                false: colors.border,
                true: colors.terraDark,
              }}
              thumbColor={colors.cream}
              ios_backgroundColor={colors.border}
            />
          </View>
        </View>

        {/* About */}
        <Text style={styles.sectionLabel}>About</Text>
        <View style={styles.group}>
          <Row
            icon="❓"
            label="Help & support"
            value="lumi.app/help"
            onPress={() =>
              void Linking.openURL('https://lumi.app/help').catch(() => {
                Alert.alert(
                  'Coming soon',
                  "We're putting the help center together.",
                );
              })
            }
          />
          <Row
            icon="📜"
            label="Terms of service"
            value="lumi.app/terms"
            onPress={() =>
              void Linking.openURL('https://lumi.app/terms').catch(() => {
                Alert.alert(
                  'Coming soon',
                  'Terms page is being finalized.',
                );
              })
            }
          />
          <Row
            icon="🔒"
            label="Privacy policy"
            value="lumi.app/privacy"
            onPress={() =>
              void Linking.openURL('https://lumi.app/privacy').catch(() => {
                Alert.alert(
                  'Coming soon',
                  'Privacy page is being finalized.',
                );
              })
            }
            last
          />
        </View>

        {/* Sign out */}
        <View style={{ height: 8 }} />
        <Pressable onPress={handleSignOut} style={styles.signOutBtn}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>

        <Text style={styles.versionText}>Lumi · v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const Row = ({
  icon,
  label,
  value,
  onPress,
  last,
}: {
  icon: string;
  label: string;
  value: string;
  onPress?: () => void;
  last?: boolean;
}) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [
      rowStyles.row,
      !last && rowStyles.divider,
      pressed && { backgroundColor: colors.card },
    ]}
  >
    <View style={rowStyles.left}>
      <Text style={rowStyles.icon}>{icon}</Text>
      <View>
        <Text style={rowStyles.label}>{label}</Text>
        <Text style={rowStyles.value}>{value}</Text>
      </View>
    </View>
    {onPress && <Text style={rowStyles.chevron}>›</Text>}
  </Pressable>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  back: { fontFamily: fonts.sansMedium, color: colors.text2, fontSize: 14 },
  title: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 18,
  },
  scroll: {
    paddingHorizontal: 18,
    paddingBottom: 80,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  hero: {
    alignItems: 'center',
    paddingVertical: 20,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 18,
    marginBottom: 22,
  },
  heroName: {
    fontFamily: fonts.serif,
    color: colors.text,
    fontSize: 22,
    marginTop: 10,
  },
  heroEmail: {
    fontFamily: fonts.sans,
    color: colors.text2,
    fontSize: 13,
    marginTop: 2,
  },
  badge: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  badgeText: {
    fontFamily: fonts.sansSemi,
    fontSize: 12,
  },

  sectionLabel: {
    fontFamily: fonts.sansSemi,
    color: colors.text3,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginBottom: 9,
    marginTop: 8,
  },
  group: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 18,
  },
  editRow: {
    padding: 14,
  },
  editActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  editCancel: {
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  editCancelText: {
    fontFamily: fonts.sansMedium,
    color: colors.text3,
    fontSize: 14,
  },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    paddingHorizontal: 16,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  rowIcon: { fontSize: 18 },
  rowLabel: {
    fontFamily: fonts.sansMedium,
    color: colors.text,
    fontSize: 14,
  },
  rowValue: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 12,
    marginTop: 1,
  },

  signOutBtn: {
    backgroundColor: colors.roseBg,
    borderColor: colors.roseBorder,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  signOutText: {
    fontFamily: fonts.sansSemi,
    color: colors.rose,
    fontSize: 14,
  },
  versionText: {
    fontFamily: fonts.sansItalic,
    color: colors.text3,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 22,
  },
});

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    paddingHorizontal: 16,
  },
  divider: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  icon: { fontSize: 16, width: 22 },
  label: {
    fontFamily: fonts.sansMedium,
    color: colors.text,
    fontSize: 14,
  },
  value: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 12,
    marginTop: 1,
  },
  chevron: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 22,
    lineHeight: 22,
  },
});
