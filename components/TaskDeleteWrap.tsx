// TaskDeleteWrap — confirm-before-delete primitives, plus a branded
// modal that replaces the system Alert with Lumi's warm "are you sure?"
// confirmation. The modal lives at the app root via DeleteConfirmProvider
// so any screen can call useDeleteConfirm(id, title) and get the same
// dusk-lit sheet — no Modal mount needed per screen.
//
// Components:
//   <DeleteConfirmProvider> — mount once at the app root (above Stack)
//   useDeleteConfirm(id, title) — returns a callback that opens the
//     modal; on Delete it calls questStore.remove(id) with success haptic
//   TaskDeleteWrap — legacy render-prop with Swipeable + long-press,
//     preserved in case any surface wants it back later. Unused today.

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Swipeable } from 'react-native-gesture-handler';
import { fonts } from '../constants/fonts';
import { useQuestStore } from '../store/questStore';

const C = {
  void: '#120E0C',
  void2: '#1A1512',
  surface: '#1F1813',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  mute: '#6E655A',
  rust: '#C56A4A',
  ember: '#E07A4F',
  hair: '#2A2420',
  dusk: '#8EA0B4',
};

// ─────────────────────────────────────────────────────────────────────
// Branded confirm modal — provider + context
// ─────────────────────────────────────────────────────────────────────
interface PendingDelete {
  id: string;
  title: string;
}

interface DeleteConfirmCtx {
  request: (id: string, title: string) => void;
}

const Ctx = createContext<DeleteConfirmCtx | null>(null);

export const DeleteConfirmProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [pending, setPending] = useState<PendingDelete | null>(null);

  const request = useCallback((id: string, title: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPending({ id, title });
  }, []);

  const cancel = useCallback(() => {
    Haptics.selectionAsync();
    setPending(null);
  }, []);

  const confirm = useCallback(() => {
    if (!pending) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    useQuestStore.getState().remove(pending.id);
    setPending(null);
  }, [pending]);

  return (
    <Ctx.Provider value={{ request }}>
      {children}
      <Modal
        visible={pending != null}
        transparent
        animationType="fade"
        onRequestClose={cancel}
        statusBarTranslucent
      >
        <View style={styles.scrim}>
          <Pressable style={StyleSheet.absoluteFill} onPress={cancel} />
          <SafeAreaView edges={['bottom']} pointerEvents="box-none">
            <View style={styles.card}>
              <Text style={styles.eyebrow}>Are you sure?</Text>
              <Text style={styles.title}>
                Delete &ldquo;{pending?.title || 'this task'}&rdquo;?
              </Text>
              <Text style={styles.body}>
                This can&apos;t be undone — the task and its history go away.
              </Text>
              <View style={styles.btnRow}>
                <Pressable onPress={cancel} style={styles.cancelBtn}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={confirm} style={styles.deleteBtn}>
                  <Text style={styles.deleteText}>Delete</Text>
                </Pressable>
              </View>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </Ctx.Provider>
  );
};

/** Returns a callback that opens a confirm to UN-complete a task.
 *  Less destructive than delete (the task comes back to your day),
 *  so we use the system Alert here. Tap-completed-task on Time tab is
 *  the main caller — recovers from accidental "Mark it done" taps
 *  past the 6-second undo window. */
export const useUncompleteConfirm = (id: string, title: string) =>
  useCallback(() => {
    Haptics.selectionAsync();
    Alert.alert(
      'Mark as not done?',
      `"${title || 'This task'}" will come back to your day.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark not done',
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            useQuestStore.getState().toggle(id);
          },
        },
      ],
    );
  }, [id, title]);

/** Returns a callback that opens the branded delete confirm modal for
 *  this task id/title. Falls back to the system Alert only if the
 *  provider isn't mounted (defensive — should never happen in app). */
export const useDeleteConfirm = (id: string, title: string) => {
  const ctx = useContext(Ctx);
  return useCallback(() => {
    if (ctx) {
      ctx.request(id, title);
      return;
    }
    // Defensive fallback if the provider isn't mounted yet.
    Alert.alert(
      'Are you sure?',
      `Delete "${title || 'this task'}"? This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => useQuestStore.getState().remove(id),
        },
      ],
    );
  }, [ctx, id, title]);
};

// ─────────────────────────────────────────────────────────────────────
// Legacy: TaskDeleteWrap — kept for any surface that wants the swipe
// affordance back. Currently unused in app; the visible × button + the
// branded modal is the canonical path.
// ─────────────────────────────────────────────────────────────────────
interface TaskDeleteWrapProps {
  id: string;
  title: string;
  children: (api: { onLongPress: () => void }) => React.ReactNode;
  disabled?: boolean;
}

export const TaskDeleteWrap = ({
  id,
  title,
  children,
  disabled = false,
}: TaskDeleteWrapProps) => {
  const ref = useRef<Swipeable | null>(null);
  const confirm = useDeleteConfirm(id, title);

  if (disabled) {
    return <>{children({ onLongPress: () => {} })}</>;
  }

  const renderRightActions = () => (
    <Pressable
      onPress={() => {
        confirm();
        ref.current?.close();
      }}
      style={swipeStyles.deleteAction}
    >
      <View style={swipeStyles.deleteGlyph}>
        <Text style={swipeStyles.deleteGlyphText}>⌫</Text>
      </View>
      <Text style={swipeStyles.deleteText}>Delete</Text>
    </Pressable>
  );

  return (
    <Swipeable
      ref={ref}
      renderRightActions={renderRightActions}
      friction={2}
      rightThreshold={42}
      overshootRight={false}
    >
      {children({ onLongPress: confirm })}
    </Swipeable>
  );
};

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(8,6,5,0.72)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: C.void2,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: C.hair,
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 14,
  },
  eyebrow: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: C.dusk,
    marginBottom: 10,
  },
  title: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 22,
    color: C.bone,
    letterSpacing: -0.4,
    lineHeight: 28,
    marginBottom: 8,
  },
  body: {
    fontFamily: fonts.inter,
    fontSize: 13,
    color: C.boneDim,
    lineHeight: 19,
    marginBottom: 22,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: C.hair,
    alignItems: 'center',
  },
  cancelText: {
    fontFamily: fonts.interSemi,
    fontSize: 14,
    color: C.boneDim,
  },
  deleteBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: C.rust,
    alignItems: 'center',
  },
  deleteText: {
    fontFamily: fonts.interSemi,
    fontSize: 14,
    color: C.bone,
  },
});

const swipeStyles = StyleSheet.create({
  deleteAction: {
    width: 92,
    backgroundColor: C.rust,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  deleteGlyph: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteGlyphText: { color: C.bone, fontSize: 14, lineHeight: 16 },
  deleteText: {
    fontFamily: fonts.interSemi,
    fontSize: 12,
    color: C.bone,
    letterSpacing: 0.3,
  },
});
