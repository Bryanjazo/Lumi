import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  Alert,
  ActivityIndicator,
  ScrollView,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { colors } from '../../constants/colors';
import { fonts } from '../../constants/fonts';
import {
  IMPORTANCE,
  Importance,
  XP_BY_IMPORTANCE,
  importanceFromDifficulty,
} from '../../constants/importance';
import { useUserStore } from '../../store/userStore';
import {
  useQuestStore,
  selectTodayQuests,
  Quest,
} from '../../store/questStore';
import { parseBrainDump } from '../../lib/anthropic';
import { XP } from '../../lib/gamification';

// XP_PER_LEVEL mirrors the JSX (flat 1000 per level).
const XP_PER_LEVEL = 1000;
const COMBO_RESET_MS = 8_000;

// ── Helpers ────────────────────────────────────────────────────────────
const greetingFor = (h: number) => {
  if (h >= 21 || h < 5) return 'Quiet night.';
  if (h >= 17) return 'Soft evening.';
  if (h >= 12) return 'Slow afternoon.';
  return 'Easy morning.';
};

const importanceFromTitle = (title: string): Importance => {
  const t = title.toLowerCase();
  if (/(dentist|doctor|med|pill|pay|bill|deadline|due|urgent)/.test(t))
    return 'high';
  if (/(walk|move|yoga|water|breathe)/.test(t)) return 'low';
  return 'medium';
};

// ── XP Floater ────────────────────────────────────────────────────────
const XpFloater = ({ amount, color }: { amount: number; color: string }) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.delay(420),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(translateY, {
        toValue: -42,
        duration: 1200,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.spring(scale, {
          toValue: 1.18,
          friction: 5,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [opacity, translateY, scale]);

  return (
    <Animated.Text
      style={[
        styles.floater,
        { color, opacity, transform: [{ translateY }, { scale }] },
      ]}
    >
      +{amount}
    </Animated.Text>
  );
};

// ── Combo Counter (full-screen pill that pops in) ────────────────────
const ComboCounter = ({ count, signal }: { count: number; signal: number }) => {
  const scale = useRef(new Animated.Value(0.5)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (count < 2) return;
    scale.setValue(0.5);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        friction: 4,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [signal, count, scale, opacity]);

  if (count < 2) return null;
  return (
    <Animated.View
      style={[
        styles.comboPill,
        { transform: [{ translateX: -65 }, { scale }], opacity },
      ]}
      pointerEvents="none"
    >
      <Text style={styles.comboText}>✦ {count}× COMBO!</Text>
    </Animated.View>
  );
};

// ── Level Up Toast ────────────────────────────────────────────────────
const LevelUpToast = ({
  show,
  level,
  title,
}: {
  show: boolean;
  level: number;
  title: string;
}) => {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (!show) return;
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 5,
        tension: 100,
        useNativeDriver: true,
      }),
    ]).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => scale.setValue(0.3));
    }, 1900);
    return () => clearTimeout(timer);
  }, [show, opacity, scale]);

  if (!show) return null;
  return (
    <Animated.View
      style={[styles.levelUpBackdrop, { opacity }]}
      pointerEvents="none"
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <LinearGradient
          colors={['#B0664A', colors.gold]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.levelUpCard}
        >
          <Text style={styles.levelUpLabel}>LEVEL UP</Text>
          <Text style={styles.levelUpNum}>{level}</Text>
          <Text style={styles.levelUpTitle}>{title}</Text>
        </LinearGradient>
      </Animated.View>
    </Animated.View>
  );
};

// ── Quest Row ─────────────────────────────────────────────────────────
const QuestRow = ({
  q,
  onToggle,
  floater,
}: {
  q: Quest;
  onToggle: () => void;
  floater: { amount: number; color: string } | null;
}) => {
  // Defensive: older persisted quests may not have importance yet
  // (added in Lumi-1006). Derive from difficulty on the fly.
  const importance = q.importance ?? importanceFromDifficulty(q.difficulty);
  const imp = IMPORTANCE[importance];
  const done = q.completed;
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [
        styles.questRow,
        done && styles.questRowDone,
        pressed && { opacity: 0.85 },
      ]}
    >
      <View
        style={[
          styles.impBar,
          { backgroundColor: imp.color, opacity: done ? 0.3 : 1 },
        ]}
      />
      <View
        style={[
          styles.check,
          {
            borderColor: done ? imp.color : colors.borderHi,
            backgroundColor: done ? imp.color : 'transparent',
          },
        ]}
      >
        {done && <Text style={styles.checkMark}>✓</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.questTitle,
            done && {
              color: colors.text3,
              textDecorationLine: 'line-through',
            },
          ]}
        >
          {q.title}
        </Text>
        <Text style={styles.impLabel}>{imp.label}</Text>
      </View>
      <View style={[styles.xpWrap, done && { opacity: 0.4 }]}>
        <Text
          style={[
            styles.xpVal,
            { color: done ? colors.text3 : imp.color },
          ]}
        >
          +{q.xpReward}
        </Text>
        {floater && <XpFloater amount={floater.amount} color={floater.color} />}
      </View>
    </Pressable>
  );
};

// ── Main Home Screen ──────────────────────────────────────────────────
type Parsed = {
  title: string;
  xp: number;
  category: string;
  importance: Importance;
};

export default function Home() {
  const router = useRouter();

  // store
  const name = useUserStore((s) => s.name);
  const streak = useUserStore((s) => s.streak);
  const xp = useUserStore((s) => s.xp);
  const addXp = useUserStore((s) => s.addXp);
  const registerActivity = useUserStore((s) => s.registerActivity);

  const quests = useQuestStore((s) => s.quests);
  const toggle = useQuestStore((s) => s.toggle);
  const addMany = useQuestStore((s) => s.addMany);
  const addQuest = useQuestStore((s) => s.addQuest);
  const todayQuests = useMemo(() => selectTodayQuests(quests), [quests]);

  // local UI state
  const [dump, setDump] = useState('');
  const [dumpFocused, setDumpFocused] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [parsed, setParsed] = useState<Parsed[]>([]);
  const [recording, setRecording] = useState(false);

  const [adding, setAdding] = useState(false);
  const [newTask, setNewTask] = useState('');
  const [newImportance, setNewImportance] = useState<Importance>('medium');
  const [newTime, setNewTime] = useState(''); // e.g., "10:30am"
  const newXp = XP_BY_IMPORTANCE[newImportance];

  // game state
  const [combo, setCombo] = useState(0);
  const [comboPulse, setComboPulse] = useState(0);
  const comboTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [floaters, setFloaters] = useState<
    Record<string, { amount: number; color: string }>
  >({});

  const [showLevelUp, setShowLevelUp] = useState(false);
  const lastLevelRef = useRef(Math.floor(xp / XP_PER_LEVEL));

  // derived
  const level = Math.max(1, Math.floor(xp / XP_PER_LEVEL) + 1);
  const xpInLevel = xp % XP_PER_LEVEL;
  const xpProgress = (xpInLevel / XP_PER_LEVEL) * 100;
  const xpToNext = XP_PER_LEVEL - xpInLevel;

  const doneCount = todayQuests.filter((q) => q.completed).length;
  const todayXp = todayQuests
    .filter((q) => q.completed)
    .reduce((s, q) => s + q.xpReward, 0);

  const hr = new Date().getHours();
  const greetingText = greetingFor(hr);
  const dayLabel = `Day ${streak || 1}`;

  // toggle handler with combo / floater / level-up
  const handleToggle = (q: Quest) => {
    const wasDone = q.completed;
    const next = toggle(q.id);
    if (!next) return;

    if (!wasDone) {
      const bonus = combo * 5;
      const gain = q.xpReward + bonus;
      const oldTotal = xp;
      const newTotal = oldTotal + gain;
      const importance = q.importance ?? importanceFromDifficulty(q.difficulty);

      addXp(gain);
      registerActivity();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      // floater (per-quest, removed after 1.2s)
      const fId = q.id + '-' + Date.now();
      setFloaters((prev) => ({
        ...prev,
        [fId]: { amount: gain, color: IMPORTANCE[importance].color },
      }));
      setTimeout(() => {
        setFloaters((prev) => {
          const copy = { ...prev };
          delete copy[fId];
          return copy;
        });
      }, 1200);

      // combo
      setCombo((c) => c + 1);
      setComboPulse((p) => p + 1);
      if (comboTimer.current) clearTimeout(comboTimer.current);
      comboTimer.current = setTimeout(() => setCombo(0), COMBO_RESET_MS);

      // level up?
      const oldLevel = Math.floor(oldTotal / XP_PER_LEVEL);
      const newLevel = Math.floor(newTotal / XP_PER_LEVEL);
      if (newLevel > oldLevel) {
        lastLevelRef.current = newLevel;
        setShowLevelUp(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(() => setShowLevelUp(false), 2200);
      }
    } else {
      // un-doing — soft penalty
      addXp(-q.xpReward);
    }
  };

  // brain dump — uses our Anthropic helper, but we also surface category
  // and importance like the JSX so the parsed list reads the same.
  const handleSort = async () => {
    if (!dump.trim()) return;
    setSorting(true);
    try {
      const res = await parseBrainDump(dump);
      const enriched: Parsed[] = res.tasks.map((t) => {
        const importance = importanceFromTitle(t.title);
        return {
          title: t.title,
          xp: XP_BY_IMPORTANCE[importance],
          category: categoryFor(t.title),
          importance,
        };
      });
      setParsed(enriched);
      addXp(XP.brainDump);
    } catch (e) {
      Alert.alert("Couldn't sort that", 'Try a shorter line and resend.');
    } finally {
      setSorting(false);
    }
  };

  const acceptTask = (idx: number) => {
    const p = parsed[idx];
    Haptics.selectionAsync();
    addQuest({
      title: p.title,
      difficulty:
        p.importance === 'high'
          ? 'hard'
          : p.importance === 'medium'
            ? 'medium'
            : 'easy',
      importance: p.importance,
      xpReward: p.xp,
    });
    setParsed((ps) => ps.filter((_, i) => i !== idx));
  };
  const dismissTask = (idx: number) => {
    Haptics.selectionAsync();
    setParsed((ps) => ps.filter((_, i) => i !== idx));
  };
  const acceptAll = () => {
    Haptics.selectionAsync();
    addMany(
      parsed.map((p) => ({
        title: p.title,
        difficulty:
          p.importance === 'high'
            ? 'hard'
            : p.importance === 'medium'
              ? 'medium'
              : 'easy',
        importance: p.importance,
      })),
    );
    setParsed([]);
    setDump('');
  };

  const handleAdd = () => {
    if (!newTask.trim()) return;
    const parsed = parseTimeInput(newTime);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    addQuest({
      title: newTask.trim(),
      difficulty:
        newImportance === 'high'
          ? 'hard'
          : newImportance === 'medium'
            ? 'medium'
            : 'easy',
      importance: newImportance,
      xpReward: XP_BY_IMPORTANCE[newImportance],
      scheduledHour: parsed?.hour,
      scheduledMinute: parsed?.minute,
      // When scheduling, default to 45-min duration so the Time tab
      // can place the user "in" the block while it's active.
      durationMinutes: parsed ? 45 : undefined,
    });
    setNewTask('');
    setNewImportance('medium');
    setNewTime('');
    setAdding(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <LevelUpToast
        show={showLevelUp}
        level={level}
        title="Focused Wanderer"
      />
      <ComboCounter count={combo} signal={comboPulse} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── GREETING ────────────────────────────── */}
        <View style={{ marginBottom: 22, flexDirection: 'row' }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>
              {new Date().toLocaleDateString(undefined, {
                weekday: 'long',
              })}{' '}
              · {dayLabel}
            </Text>
            <Text style={styles.h1}>{greetingText}</Text>
            {name ? <Text style={styles.h1Sub}>Hey {name}.</Text> : null}
          </View>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              router.push('/profile');
            }}
            style={styles.gear}
            hitSlop={10}
          >
            <Text style={styles.gearIcon}>⚙︎</Text>
          </Pressable>
        </View>

        {/* ── HERO STAT CARD ─────────────────────── */}
        <LinearGradient
          colors={[colors.cardHi, colors.surface]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          {/* shimmer */}
          <View style={styles.heroShimmer} />

          <View style={styles.heroTop}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {/* level badge */}
              <View style={styles.levelBadge}>
                <Text style={styles.levelBadgeNum}>{level}</Text>
                <Text style={styles.levelBadgeLbl}>LVL</Text>
              </View>
              <View>
                <Text style={styles.heroTitle}>Focused Wanderer</Text>
                <Text style={styles.heroTotal}>
                  {xp.toLocaleString()} XP total
                </Text>
              </View>
            </View>
            {/* streak */}
            <View style={styles.streakPill}>
              <Text style={{ fontSize: 14 }}>🔥</Text>
              <Text style={styles.streakNum}>{streak || 0}</Text>
            </View>
          </View>

          {/* XP bar */}
          <View>
            <View style={styles.xpHeader}>
              <Text style={styles.xpLabel}>LEVEL {level}</Text>
              <Text style={styles.xpFrac}>
                {xpInLevel} / {XP_PER_LEVEL}
              </Text>
            </View>
            <View style={styles.xpTrack}>
              <LinearGradient
                colors={['#B0664A', colors.terra, colors.honey]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.xpFill, { width: `${xpProgress}%` }]}
              />
            </View>
            <View style={styles.xpFooter}>
              <Text style={styles.todayXp}>+{todayXp} XP today</Text>
              <Text style={styles.toNext}>
                {xpToNext} to level {level + 1} →
              </Text>
            </View>
          </View>
        </LinearGradient>

        {/* ── COMBO ACTIVE INDICATOR ─────────────── */}
        {combo > 0 && (
          <View style={styles.comboCard}>
            <Text style={{ fontSize: 14 }}>⚡</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.comboActive}>{combo}× combo active</Text>
              <Text style={styles.comboHint}>
                +{combo * 5} bonus XP per task · resets in 8s
              </Text>
            </View>
          </View>
        )}

        {/* ── IMPORTANCE LEGEND ──────────────────── */}
        <View style={styles.legend}>
          {(Object.entries(IMPORTANCE) as [Importance, typeof IMPORTANCE['high']][]).map(
            ([key, val]) => (
              <View key={key} style={styles.legendItem}>
                <View
                  style={[styles.legendDot, { backgroundColor: val.color }]}
                />
                <Text style={styles.legendLabel}>{val.label}</Text>
              </View>
            ),
          )}
        </View>

        {/* ── TODAY HEADER ──────────────────────── */}
        <View style={styles.todayHeader}>
          <View style={styles.todayLeft}>
            <Text style={styles.todayLabel}>Today</Text>
            <Text
              style={[
                styles.todayCount,
                doneCount === todayQuests.length &&
                  todayQuests.length > 0 && {
                    color: colors.sage,
                    fontFamily: fonts.sansSemi,
                  },
              ]}
            >
              {doneCount === todayQuests.length && todayQuests.length > 0
                ? '✓ ALL DONE!'
                : `${doneCount}/${todayQuests.length || 0}`}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setAdding(true);
            }}
            style={[styles.addBtn, adding && { opacity: 0.4 }]}
          >
            <Text style={styles.addBtnText}>+ Add</Text>
          </Pressable>
        </View>

        {/* ── MANUAL ADD FORM ──────────────────── */}
        {adding && (
          <View style={styles.addForm}>
            <TextInput
              placeholder="What's the task?"
              placeholderTextColor={colors.text3}
              value={newTask}
              onChangeText={setNewTask}
              onSubmitEditing={handleAdd}
              autoFocus
              style={styles.addInput}
              returnKeyType="done"
            />
            <View style={styles.addControls}>
              <View style={styles.impPicker}>
                {(Object.entries(IMPORTANCE) as [Importance, typeof IMPORTANCE['high']][]).map(
                  ([key, val]) => {
                    const sel = newImportance === key;
                    return (
                      <Pressable
                        key={key}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setNewImportance(key);
                        }}
                        style={[
                          styles.impChoice,
                          {
                            backgroundColor: sel
                              ? `${val.color}1a`
                              : 'transparent',
                            borderColor: sel ? val.color : colors.border,
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.legendDot,
                            { backgroundColor: val.color },
                          ]}
                        />
                        <Text
                          style={[
                            styles.impChoiceText,
                            { color: sel ? val.color : colors.text3 },
                          ]}
                        >
                          {val.label}
                        </Text>
                      </Pressable>
                    );
                  },
                )}
              </View>
              <View style={styles.xpAuto}>
                <Text style={styles.xpAutoLabel}>auto</Text>
                <Text
                  style={[
                    styles.xpAutoVal,
                    { color: IMPORTANCE[newImportance].color },
                  ]}
                >
                  +{newXp}
                </Text>
              </View>
            </View>

            {/* Schedule time (optional) — feeds the Time tab radar */}
            <View style={styles.timeRow}>
              <Text style={styles.timeLabel}>at</Text>
              <TextInput
                placeholder="e.g. 10:30am  (optional)"
                placeholderTextColor={colors.text3}
                value={newTime}
                onChangeText={setNewTime}
                style={styles.timeInput}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {newTime && parseTimeInput(newTime) === null && (
                <Text style={styles.timeBad}>?</Text>
              )}
              {newTime && parseTimeInput(newTime) !== null && (
                <Text style={styles.timeOk}>✓</Text>
              )}
            </View>

            <View style={styles.addActions}>
              <Pressable
                onPress={() => {
                  setNewTask('');
                  setNewImportance('medium');
                  setNewTime('');
                  setAdding(false);
                }}
                style={styles.addCancel}
              >
                <Text style={styles.addCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleAdd}
                disabled={!newTask.trim()}
                style={[
                  styles.addConfirm,
                  !newTask.trim() && styles.addConfirmDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.addConfirmText,
                    !newTask.trim() && { color: colors.text3 },
                  ]}
                >
                  Add task ↵
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* ── QUEST LIST ──────────────────────── */}
        <View style={{ marginBottom: 24 }}>
          {todayQuests.length === 0 ? (
            <Text style={styles.empty}>
              Nothing on the list. Add one above or brain-dump below.
            </Text>
          ) : (
            todayQuests.map((q) => {
              const floater = Object.entries(floaters).find(([k]) =>
                k.startsWith(q.id + '-'),
              )?.[1];
              return (
                <QuestRow
                  key={q.id}
                  q={q}
                  onToggle={() => handleToggle(q)}
                  floater={floater ?? null}
                />
              );
            })
          )}
        </View>

        {/* ── DAILY GOAL PROGRESS ──────────────── */}
        {todayQuests.length > 0 && (
          <View
            style={[
              styles.goalCard,
              doneCount === todayQuests.length && {
                backgroundColor: colors.sageBg,
                borderColor: colors.sage,
              },
            ]}
          >
            <Text style={{ fontSize: 22 }}>
              {doneCount === todayQuests.length
                ? '🌟'
                : doneCount >= 3
                  ? '🔥'
                  : doneCount >= 1
                    ? '✨'
                    : '🌙'}
            </Text>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.goalTitle,
                  doneCount === todayQuests.length && { color: colors.sage },
                ]}
              >
                {doneCount === todayQuests.length
                  ? 'Perfect day!'
                  : doneCount >= 3
                    ? "You're on fire"
                    : doneCount >= 1
                      ? 'Great start'
                      : 'Take it slow today'}
              </Text>
              <Text style={styles.goalBody}>
                {doneCount === todayQuests.length
                  ? `+${todayXp + 100} XP earned · 100 bonus XP for full day!`
                  : `${doneCount}/${todayQuests.length} done · ${todayQuests.length - doneCount} to go`}
              </Text>
            </View>
          </View>
        )}

        {/* ── BRAIN DUMP ──────────────────────── */}
        <View style={styles.brainDumpSection}>
          <View style={styles.brainDumpHeader}>
            <Text style={styles.brainDumpEyebrow}>Brain dump</Text>
            <Text style={styles.aiHint}>✦ ai will sort it</Text>
          </View>

          <View
            style={[
              styles.brainDumpCard,
              dumpFocused && { borderColor: colors.terra },
            ]}
          >
            <TextInput
              placeholder="Everything that's on your mind — I'll need to call the dentist, the report is due Friday, I forgot to feed the dog…"
              placeholderTextColor={colors.text3}
              value={dump}
              onChangeText={setDump}
              onFocus={() => setDumpFocused(true)}
              onBlur={() => setDumpFocused(false)}
              multiline
              numberOfLines={3}
              style={styles.brainDumpInput}
            />
            <View style={styles.brainDumpFooter}>
              <Pressable
                onPress={() => setRecording((r) => !r)}
                style={[
                  styles.recordBtn,
                  recording && { backgroundColor: colors.terraBg },
                ]}
              >
                <Text
                  style={[
                    styles.recordIcon,
                    { color: recording ? colors.terra : colors.text3 },
                  ]}
                >
                  {recording ? '●' : '🎙'}
                </Text>
                <Text
                  style={[
                    styles.recordText,
                    { color: recording ? colors.terra : colors.text3 },
                  ]}
                >
                  {recording ? 'Listening…' : 'Speak instead'}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleSort}
                disabled={!dump.trim() || sorting}
                style={[
                  styles.sortBtn,
                  dump.trim() && !sorting
                    ? styles.sortBtnActive
                    : styles.sortBtnDisabled,
                ]}
              >
                {sorting ? (
                  <ActivityIndicator size="small" color={colors.text3} />
                ) : (
                  <Text
                    style={[
                      styles.sortBtnText,
                      {
                        color:
                          dump.trim() && !sorting ? '#fff' : colors.text3,
                      },
                    ]}
                  >
                    Sort into tasks →
                  </Text>
                )}
              </Pressable>
            </View>
          </View>

          {parsed.length > 0 && (
            <View style={{ marginTop: 14 }}>
              <Text style={styles.foundLabel}>
                ✦ Found {parsed.length} thing{parsed.length === 1 ? '' : 's'}
              </Text>
              {parsed.map((p, i) => (
                <View key={i} style={styles.parsedRow}>
                  <View
                    style={[
                      styles.parsedBar,
                      { backgroundColor: IMPORTANCE[p.importance].color },
                    ]}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.parsedTitle}>{p.title}</Text>
                    <Text style={styles.parsedMeta}>
                      +{p.xp} XP · {IMPORTANCE[p.importance].label} ·{' '}
                      {p.category}
                    </Text>
                  </View>
                  <Pressable onPress={() => acceptTask(i)} hitSlop={6}>
                    <Text style={styles.parsedAdd}>add</Text>
                  </Pressable>
                  <Pressable onPress={() => dismissTask(i)} hitSlop={6}>
                    <Text style={styles.parsedDismiss}>×</Text>
                  </Pressable>
                </View>
              ))}
              <Pressable onPress={acceptAll}>
                <Text style={styles.addAll}>Add all to today →</Text>
              </Pressable>
            </View>
          )}

          <Text style={styles.brainDumpFooterText}>
            Messy is fine. Just get it out — Lumi turns it into doable steps.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Helpers (continued) ─────────────────────────────────────────────
/**
 * Parse a time string into { hour, minute } (24-hr). Accepts:
 *   "10:30am", "10:30 am", "10am", "10 am"
 *   "2pm", "2:30 PM"
 *   "14:30", "14"  (24-hr)
 * Returns null if unparseable.
 */
const parseTimeInput = (
  raw: string,
): { hour: number; minute: number } | null => {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const period = m[3];
  if (Number.isNaN(h) || min < 0 || min > 59) return null;
  if (period === 'am') {
    if (h === 12) h = 0;
    else if (h < 1 || h > 12) return null;
  } else if (period === 'pm') {
    if (h === 12) h = 12;
    else if (h >= 1 && h <= 11) h += 12;
    else return null;
  } else {
    // 24-hr — must be 0–23
    if (h < 0 || h > 23) return null;
  }
  return { hour: h, minute: min };
};

const categoryFor = (title: string): string => {
  const t = title.toLowerCase();
  if (/(call|email|reply|text|message)/.test(t)) return 'Communication';
  if (/(report|work|deadline|deck|meeting)/.test(t)) return 'Work';
  if (/(med|pill|doctor|dentist|appoint)/.test(t)) return 'Health';
  if (/(dog|cat|pet|feed)/.test(t)) return 'Home';
  if (/(grocery|store|shop)/.test(t)) return 'Errands';
  if (/(walk|run|yoga|move|exercise|workout)/.test(t)) return 'Health';
  return 'Personal';
};

// ── Styles ──────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 120,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },

  // greeting
  eyebrow: {
    fontFamily: fonts.sansSemi,
    fontSize: 10,
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: colors.terra,
    opacity: 0.6,
    marginBottom: 6,
  },
  h1: {
    fontFamily: fonts.serifItalic,
    fontSize: 28,
    color: colors.cream,
    lineHeight: 34,
  },
  h1Sub: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.text2,
    marginTop: 4,
  },
  gear: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearIcon: { fontSize: 16, color: colors.text2 },

  // hero stat card
  heroCard: {
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: colors.border,
    position: 'relative',
    overflow: 'hidden',
  },
  heroShimmer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.terraGlow,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  levelBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.terraBg,
    borderWidth: 1.5,
    borderColor: '#B0664A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelBadgeNum: {
    fontFamily: fonts.serif,
    fontSize: 18,
    color: colors.terra,
    lineHeight: 20,
  },
  levelBadgeLbl: {
    fontFamily: fonts.sansSemi,
    fontSize: 7,
    color: colors.terra,
    opacity: 0.7,
    letterSpacing: 1,
    marginTop: 1,
  },
  heroTitle: {
    fontFamily: fonts.sansSemi,
    fontSize: 13,
    color: colors.cream,
    marginBottom: 1,
  },
  heroTotal: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.text3,
  },
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.honeyBg,
    borderWidth: 1,
    borderColor: 'rgba(201,160,106,0.25)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 100,
  },
  streakNum: {
    fontFamily: fonts.sansSemi,
    fontSize: 13,
    color: colors.honey,
    letterSpacing: 0.3,
  },
  xpHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  xpLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.text3,
  },
  xpFrac: {
    fontFamily: fonts.sans,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.text3,
  },
  xpTrack: {
    height: 6,
    backgroundColor: colors.bg,
    borderRadius: 10,
    overflow: 'hidden',
  },
  xpFill: { height: '100%', borderRadius: 10 },
  xpFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  todayXp: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.text3,
  },
  toNext: {
    fontFamily: fonts.sansSemi,
    fontSize: 10,
    color: colors.terra,
  },

  // combo card
  comboCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    backgroundColor: colors.terraBg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.terra,
    borderRadius: 10,
  },
  comboActive: {
    fontFamily: fonts.sansSemi,
    fontSize: 12,
    color: colors.terra,
    letterSpacing: 0.3,
  },
  comboHint: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.text3,
  },

  // combo full-screen pop
  comboPill: {
    position: 'absolute',
    top: 80,
    left: '50%',
    backgroundColor: '#B0664A',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 100,
    zIndex: 100,
  },
  comboText: {
    fontFamily: fonts.sansSemi,
    color: '#fff',
    fontSize: 13,
    letterSpacing: 0.5,
  },

  // level-up
  levelUpBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
  },
  levelUpCard: {
    paddingVertical: 28,
    paddingHorizontal: 36,
    borderRadius: 24,
    alignItems: 'center',
  },
  levelUpLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 11,
    letterSpacing: 4,
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 6,
  },
  levelUpNum: {
    fontFamily: fonts.serif,
    fontSize: 42,
    color: '#fff',
    lineHeight: 44,
  },
  levelUpTitle: {
    fontFamily: fonts.serifItalic,
    fontSize: 12,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 8,
  },

  // legend
  legend: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 14,
    paddingTop: 2,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.text3,
    textTransform: 'uppercase',
  },

  // today header
  todayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  todayLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  todayLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 11,
    letterSpacing: 2.5,
    color: colors.text3,
    textTransform: 'uppercase',
  },
  todayCount: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.text3,
  },
  addBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.terraBg,
    borderWidth: 1,
    borderColor: 'rgba(216,152,120,0.2)',
  },
  addBtnText: {
    fontFamily: fonts.sansSemi,
    fontSize: 11,
    color: colors.terra,
    letterSpacing: 0.3,
  },

  // add form
  addForm: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.terra,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  addInput: {
    fontFamily: fonts.sans,
    color: colors.text,
    fontSize: 14,
    marginBottom: 10,
    paddingVertical: 4,
  },
  addControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  impPicker: { flexDirection: 'row', gap: 6 },
  impChoice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  impChoiceText: {
    fontFamily: fonts.sansSemi,
    fontSize: 10,
    letterSpacing: 0.3,
  },
  xpAuto: {
    alignItems: 'flex-end',
    gap: 1,
  },
  xpAutoLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 8,
    letterSpacing: 1.5,
    color: colors.text3,
    textTransform: 'uppercase',
  },
  xpAutoVal: {
    fontFamily: fonts.serifItalic,
    fontSize: 18,
    lineHeight: 20,
  },
  // Schedule time field
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  timeLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 10,
    letterSpacing: 1.8,
    color: colors.text3,
    textTransform: 'uppercase',
  },
  timeInput: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.text,
    paddingVertical: 4,
  },
  timeOk: {
    fontFamily: fonts.sansSemi,
    fontSize: 14,
    color: colors.moss,
  },
  timeBad: {
    fontFamily: fonts.sansSemi,
    fontSize: 14,
    color: colors.text3,
  },
  addActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  addCancel: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  addCancelText: {
    fontFamily: fonts.sansSemi,
    color: colors.text3,
    fontSize: 12,
  },
  addConfirm: {
    flex: 2,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#B0664A',
    alignItems: 'center',
  },
  addConfirmDisabled: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
    opacity: 0.5,
  },
  addConfirmText: {
    fontFamily: fonts.sansSemi,
    color: '#fff',
    fontSize: 12,
    letterSpacing: 0.2,
  },

  // quest row
  empty: {
    fontFamily: fonts.sansItalic,
    color: colors.text3,
    textAlign: 'center',
    fontSize: 13,
    paddingVertical: 24,
  },
  questRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 6,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderHi,
    borderRadius: 12,
    position: 'relative',
    overflow: 'hidden',
  },
  questRowDone: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
  },
  impBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  checkMark: {
    fontFamily: fonts.sansSemi,
    color: colors.bg,
    fontSize: 11,
    lineHeight: 13,
  },
  questTitle: {
    fontFamily: fonts.sansMedium,
    color: colors.text,
    fontSize: 14,
    letterSpacing: 0.1,
    marginBottom: 2,
  },
  impLabel: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 10,
    letterSpacing: 0.3,
  },
  xpWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    position: 'relative',
  },
  xpVal: {
    fontFamily: fonts.serifItalic,
    fontSize: 16,
  },
  floater: {
    position: 'absolute',
    right: 0,
    top: 0,
    fontFamily: fonts.serifItalic,
    fontSize: 16,
  },

  // daily goal
  goalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    marginBottom: 24,
  },
  goalTitle: {
    fontFamily: fonts.sansSemi,
    color: colors.cream,
    fontSize: 12,
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  goalBody: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 11,
    lineHeight: 16,
  },

  // brain dump
  brainDumpSection: {
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  brainDumpHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 10,
  },
  brainDumpEyebrow: {
    fontFamily: fonts.sansSemi,
    fontSize: 10,
    letterSpacing: 2.5,
    color: colors.text3,
    textTransform: 'uppercase',
  },
  aiHint: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    color: colors.terra,
    opacity: 0.7,
    letterSpacing: 0.5,
  },
  brainDumpCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
  },
  brainDumpInput: {
    fontFamily: fonts.sans,
    color: colors.text,
    fontSize: 13,
    lineHeight: 21,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  brainDumpFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  recordBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  recordIcon: { fontSize: 13 },
  recordText: {
    fontFamily: fonts.sansSemi,
    fontSize: 11,
  },
  sortBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  sortBtnActive: {
    backgroundColor: '#B0664A',
  },
  sortBtnDisabled: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  sortBtnText: {
    fontFamily: fonts.sansSemi,
    fontSize: 11,
    letterSpacing: 0.2,
  },

  foundLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 10,
    letterSpacing: 2,
    color: colors.terra,
    opacity: 0.7,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  parsedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
    backgroundColor: colors.terraBg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(216,152,120,0.3)',
    borderRadius: 10,
  },
  parsedBar: { width: 3, height: 20, borderRadius: 3 },
  parsedTitle: {
    fontFamily: fonts.sansMedium,
    color: colors.text,
    fontSize: 13,
    marginBottom: 2,
  },
  parsedMeta: {
    fontFamily: fonts.sans,
    color: colors.text3,
    fontSize: 10,
    letterSpacing: 0.3,
  },
  parsedAdd: {
    fontFamily: fonts.sansSemi,
    color: colors.sage,
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 4,
    letterSpacing: 0.2,
  },
  parsedDismiss: {
    color: colors.text3,
    fontSize: 16,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  addAll: {
    fontFamily: fonts.sansSemi,
    color: colors.terra,
    fontSize: 11,
    textAlign: 'center',
    padding: 8,
    letterSpacing: 0.3,
  },
  brainDumpFooterText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.text4,
    marginTop: 10,
    lineHeight: 17,
  },
});
