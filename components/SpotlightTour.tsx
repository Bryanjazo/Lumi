// Lumi · SpotlightTour — passive coachmark overlay.
//
// Architecture: lumi-onboarding-architecture §6.1.
// Renders a Modal (full window cover including the tab bar), dims the
// scene, cuts a circular hole around the registered target via SVG
// mask, draws a dashed ember ring on the cutout, and floats a caption
// card next to it. Always shows a "Skip tour" link top-right. One-shot
// per user (persists via userStore.tourSeen).
//
// The flow:
//   useTour().start()  → step 0 begins
//   next()             → advance, or end + setTourSeen()
//   skip()             → end + setTourSeen()
//
// Callers register their targets with useTourTarget(id) — returns a
// `ref` to assign to a View. The tour measures the view via
// View.measureInWindow.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
  Animated,
  Easing,
  Platform,
} from 'react-native';
import Svg, {
  Circle,
  Defs,
  Mask,
  Rect,
} from 'react-native-svg';
import { fonts } from '../constants/fonts';
import { TOUR_STEPS } from '../constants/tour';
import { useUserStore } from '../store/userStore';
import { useAccent, accentFor, type Accent } from '../lib/theme';

const PADDING = 14; // halo padding around target

const C = {
  void: '#120E0C',
  bone: '#ECE0CB',
  boneDim: '#B0A38B',
  ember: '#E07A4F',
  mute: '#6E655A',
  hair: '#2A2420',
} as const;

// ═════════════════════════════════════════════════════════════════════
// Registry context
// ═════════════════════════════════════════════════════════════════════
type TargetRef = { current: View | null };

interface TourContextValue {
  register: (id: string, ref: TargetRef) => void;
  unregister: (id: string) => void;
  /** Begin the tour from step 0. No-op if already seen. */
  start: () => void;
  /** Is the tour currently visible? */
  active: boolean;
}

const TourContext = createContext<TourContextValue>({
  register: () => {},
  unregister: () => {},
  start: () => {},
  active: false,
});

export const useTour = () => useContext(TourContext);

/**
 * Register a View as a tour target. Returns a callback ref — assign it
 * to the View you want highlighted. The registry holds the ref by id
 * so the tour can measure it on demand.
 */
export const useTourTarget = (id: string) => {
  const ctx = useContext(TourContext);
  const ref = useRef<View | null>(null);
  // Re-register on every render so the latest ref wins; cheap.
  useEffect(() => {
    ctx.register(id, ref);
    return () => ctx.unregister(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return ref;
};

// ═════════════════════════════════════════════════════════════════════
// Provider — wraps the app, renders the overlay when active
// ═════════════════════════════════════════════════════════════════════
interface TargetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const TourProvider = ({ children }: { children: ReactNode }) => {
  const targets = useRef<Record<string, TargetRef>>({});
  const [step, setStep] = useState(-1); // -1 = inactive
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const setTourSeen = useUserStore((s) => s.setTourSeen);

  const register = useCallback((id: string, ref: TargetRef) => {
    targets.current[id] = ref;
  }, []);
  const unregister = useCallback((id: string) => {
    delete targets.current[id];
  }, []);

  const measureCurrent = useCallback(
    (idx: number, attempt = 0) => {
      const cur = TOUR_STEPS[idx];
      if (!cur) return;
      const target = targets.current[cur.targetId];
      const v = target?.current;
      if (!v) {
        // Target not registered yet — for optional steps, skip ahead.
        if (cur.optional && attempt === 0) {
          if (idx < TOUR_STEPS.length - 1) measureCurrent(idx + 1);
          else end();
          return;
        }
        // Otherwise retry a couple times — refs settle a frame late.
        if (attempt < 8) {
          setTimeout(() => measureCurrent(idx, attempt + 1), 80);
        }
        return;
      }
      v.measureInWindow((x, y, w, h) => {
        if (w === 0 || h === 0) {
          if (attempt < 8) {
            setTimeout(() => measureCurrent(idx, attempt + 1), 80);
            return;
          }
          if (cur.optional && idx < TOUR_STEPS.length - 1) {
            measureCurrent(idx + 1);
            return;
          }
        }
        setTargetRect({ x, y, w, h });
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const start = useCallback(() => {
    setStep(0);
    // Let one frame pass so the target is mounted/laid-out.
    setTimeout(() => measureCurrent(0), 50);
  }, [measureCurrent]);

  const end = useCallback(() => {
    setStep(-1);
    setTargetRect(null);
    setTourSeen();
  }, [setTourSeen]);

  const next = useCallback(() => {
    const nextStep = step + 1;
    if (nextStep >= TOUR_STEPS.length) {
      end();
      return;
    }
    setStep(nextStep);
    setTargetRect(null);
    setTimeout(() => measureCurrent(nextStep), 50);
  }, [step, end, measureCurrent]);

  const skip = useCallback(() => {
    end();
  }, [end]);

  const value = useMemo<TourContextValue>(
    () => ({ register, unregister, start, active: step >= 0 }),
    [register, unregister, start, step],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      <SpotlightOverlay
        step={step}
        rect={targetRect}
        onNext={next}
        onSkip={skip}
      />
    </TourContext.Provider>
  );
};

// ═════════════════════════════════════════════════════════════════════
// The overlay — Modal + Svg mask + caption card
// ═════════════════════════════════════════════════════════════════════
const SpotlightOverlay = ({
  step,
  rect,
  onNext,
  onSkip,
}: {
  step: number;
  rect: TargetRect | null;
  onNext: () => void;
  onSkip: () => void;
}) => {
  const accent = useAccent();
  const styles = useMemo(() => makeStyles(accent), [accent]);
  const visible = step >= 0;
  const cur = step >= 0 ? TOUR_STEPS[step] : null;
  const { width: W, height: H } = Dimensions.get('window');
  const isLast = step === TOUR_STEPS.length - 1;

  // Pulse the dashed ring.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    pulse.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.out(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 0,
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, pulse]);

  // Layout the caption: above the target if it's in the lower half,
  // otherwise below.
  let captionTop = 0;
  let captionPlacement: 'above' | 'below' = 'below';
  let cx = W / 2;
  let cy = H / 2;
  let radius = 60;
  if (rect) {
    cx = rect.x + rect.w / 2;
    cy = rect.y + rect.h / 2;
    radius = Math.max(rect.w, rect.h) / 2 + PADDING;
    const captionH = 200;
    if (cy > H / 2) {
      captionPlacement = 'above';
      captionTop = Math.max(
        80,
        rect.y - PADDING - captionH - 16,
      );
    } else {
      captionPlacement = 'below';
      captionTop = Math.min(
        H - captionH - 80,
        rect.y + rect.h + PADDING + 18,
      );
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onSkip}
      statusBarTranslucent
    >
      <View style={StyleSheet.absoluteFill}>
        {/* Dimmed scene with a circular cutout */}
        <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
          <Defs>
            <Mask id="dim-mask">
              {/* white = dimmed, black = visible */}
              <Rect x={0} y={0} width={W} height={H} fill="white" />
              {rect && (
                <Circle cx={cx} cy={cy} r={radius} fill="black" />
              )}
            </Mask>
          </Defs>
          <Rect
            x={0}
            y={0}
            width={W}
            height={H}
            fill="rgba(8,6,5,0.78)"
            mask="url(#dim-mask)"
          />
          {/* Dashed ember ring on the cutout */}
          {rect && (
            <Circle
              cx={cx}
              cy={cy}
              r={radius + 2}
              stroke={accent.fg}
              strokeWidth={1.5}
              fill="none"
              strokeDasharray="6,5"
              opacity={0.9}
            />
          )}
        </Svg>

        {/* Pulse ring (Animated) overlay */}
        {rect && (
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: cx - (radius + 6),
              top: cy - (radius + 6),
              width: (radius + 6) * 2,
              height: (radius + 6) * 2,
              borderRadius: radius + 6,
              borderWidth: 1,
              borderColor: accent.fg,
              opacity: pulse.interpolate({
                inputRange: [0, 1],
                outputRange: [0.6, 0],
              }),
              transform: [
                {
                  scale: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 1.18],
                  }),
                },
              ],
            }}
          />
        )}

        {/* Skip tour — top right */}
        <Pressable
          onPress={onSkip}
          style={[styles.skipBtn, { top: Platform.OS === 'ios' ? 58 : 22 }]}
          hitSlop={8}
        >
          <Text style={styles.skipText}>Skip tour</Text>
        </Pressable>

        {/* Caption card */}
        {cur && rect && (
          <View
            style={[
              styles.captionCard,
              {
                top: captionTop,
              },
            ]}
          >
            <View style={styles.captionHead}>
              <Text style={styles.captionSpark}>✦</Text>
              <Text style={styles.captionStep}>
                {step + 1} of {TOUR_STEPS.length}
              </Text>
            </View>
            <Text style={styles.captionText}>{cur.caption}</Text>
            <View style={styles.captionFoot}>
              {!isLast && (
                <View style={styles.dotRow}>
                  {TOUR_STEPS.map((_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.dot,
                        {
                          backgroundColor:
                            i === step
                              ? accent.fg
                              : i < step
                                ? accent.fg
                                : C.hair,
                          opacity: i === step ? 1 : 0.6,
                        },
                      ]}
                    />
                  ))}
                </View>
              )}
              <Pressable onPress={onNext} style={styles.nextBtn}>
                <Text style={styles.nextBtnText}>
                  {isLast ? 'Got it' : 'Next →'}
                </Text>
              </Pressable>
            </View>
            {/* Connector triangle pointing at the cutout */}
            <View
              style={[
                captionPlacement === 'below'
                  ? styles.triangleUp
                  : styles.triangleDown,
                {
                  left: Math.max(
                    18,
                    Math.min(W - 38, cx - 10),
                  ),
                },
              ]}
            />
          </View>
        )}
      </View>
    </Modal>
  );
};

// ═════════════════════════════════════════════════════════════════════
// Styles
// ═════════════════════════════════════════════════════════════════════
const makeStyles = (accent: Accent) => StyleSheet.create({
  skipBtn: {
    position: 'absolute',
    right: 18,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 100,
    backgroundColor: 'rgba(20,15,12,0.78)',
    borderWidth: 1,
    borderColor: C.hair,
  },
  skipText: {
    fontFamily: fonts.interSemi,
    fontSize: 12,
    color: C.boneDim,
    letterSpacing: 0.2,
  },

  captionCard: {
    position: 'absolute',
    left: 18,
    right: 18,
    backgroundColor: C.void,
    borderWidth: 1,
    borderColor: accent.fg,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 16,
    shadowColor: accent.fg,
    shadowOpacity: 0.3,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  captionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  captionSpark: { color: accent.fg, fontSize: 13 },
  captionStep: {
    fontFamily: fonts.interSemi,
    fontSize: 10,
    letterSpacing: 2,
    color: accent.fg,
    textTransform: 'uppercase',
  },
  captionText: {
    fontFamily: fonts.fraunces,
    fontStyle: 'italic',
    fontSize: 18,
    color: C.bone,
    lineHeight: 24,
    letterSpacing: -0.3,
    marginBottom: 16,
  },
  captionFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dotRow: { flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  nextBtn: {
    backgroundColor: accent.fg,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 100,
  },
  nextBtnText: {
    fontFamily: fonts.interSemi,
    fontSize: 13,
    color: C.void,
    letterSpacing: 0.2,
  },

  // Connector triangles
  triangleUp: {
    position: 'absolute',
    top: -10,
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 11,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: accent.fg,
  },
  triangleDown: {
    position: 'absolute',
    bottom: -10,
    width: 0,
    height: 0,
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderTopWidth: 11,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: accent.fg,
  },
});

