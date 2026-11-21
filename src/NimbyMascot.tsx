import { useEffect } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

const sprites = {
  idle: require('./assets/mascot/01_neutral.png'),
  happy: require('./assets/mascot/02_happy.png'),
  excited: require('./assets/mascot/03_excited.png'),
  thinking: require('./assets/mascot/04_thinking.png'),
  scanning: require('./assets/mascot/05_scanning.png'),
  discovering: require('./assets/mascot/06_discovering.png'),
  organizing: require('./assets/mascot/07_organizing.png'),
  resting: require('./assets/mascot/08_resting.png'),
  success: require('./assets/mascot/09_success.png'),
} as const;

export type MascotState = keyof typeof sprites;

const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);

type Motion = {
  float: number;
  breathe: number;
  tilt: number;
  bounce?: 'once' | 'pop';
};

/** Per-expression motion — transform/opacity only, UI-thread loops. */
const motionFor: Record<MascotState, Motion> = {
  idle: { float: 4, breathe: 0.02, tilt: 0 },
  happy: { float: 5, breathe: 0.025, tilt: 0, bounce: 'once' },
  excited: { float: 7, breathe: 0.03, tilt: 3, bounce: 'pop' },
  thinking: { float: 6, breathe: 0.015, tilt: 4 },
  scanning: { float: 10, breathe: 0.02, tilt: 2 },
  discovering: { float: 8, breathe: 0.025, tilt: 5 },
  organizing: { float: 5, breathe: 0.02, tilt: 6 },
  resting: { float: 3, breathe: 0.012, tilt: 0 },
  success: { float: 4, breathe: 0.02, tilt: 0, bounce: 'pop' },
};

export function NimbyMascot({
  state = 'idle',
  size = 160,
  style,
}: {
  state?: MascotState;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const rotate = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    cancelAnimation(translateY);
    cancelAnimation(scale);
    cancelAnimation(rotate);
    cancelAnimation(opacity);

    opacity.set(0.92);
    opacity.set(withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System }));

    if (reduced) {
      translateY.set(0);
      scale.set(1);
      rotate.set(0);
      return;
    }

    const motion = motionFor[state];
    translateY.set(0);
    scale.set(1);
    rotate.set(0);

    if (motion.bounce === 'pop') {
      scale.set(withSequence(
        withSpring(1.12, { duration: 280, dampingRatio: 0.55, reduceMotion: ReduceMotion.System }),
        withSpring(1, { duration: 360, dampingRatio: 0.75, reduceMotion: ReduceMotion.System }),
      ));
    } else if (motion.bounce === 'once') {
      scale.set(withSequence(
        withSpring(1.06, { duration: 320, dampingRatio: 0.7, reduceMotion: ReduceMotion.System }),
        withSpring(1, { duration: 400, dampingRatio: 0.85, reduceMotion: ReduceMotion.System }),
      ));
    }

    const floatMs = state === 'scanning' ? 1400 : state === 'resting' ? 2800 : 2000;
    translateY.set(withRepeat(
      withSequence(
        withTiming(-motion.float, { duration: floatMs, easing: EASE_IN_OUT, reduceMotion: ReduceMotion.System }),
        withTiming(motion.float * 0.35, { duration: floatMs, easing: EASE_IN_OUT, reduceMotion: ReduceMotion.System }),
      ),
      -1,
      true,
    ));

    if (motion.breathe > 0 && !motion.bounce) {
      scale.set(withRepeat(
        withSequence(
          withTiming(1 + motion.breathe, { duration: floatMs, easing: EASE_IN_OUT, reduceMotion: ReduceMotion.System }),
          withTiming(1 - motion.breathe * 0.5, { duration: floatMs, easing: EASE_IN_OUT, reduceMotion: ReduceMotion.System }),
        ),
        -1,
        true,
      ));
    } else if (motion.breathe > 0 && motion.bounce) {
      // After entrance bounce settles, ease into a gentle breathe loop.
      const breatheDelay = motion.bounce === 'pop' ? 700 : 800;
      const timer = setTimeout(() => {
        scale.set(withRepeat(
          withSequence(
            withTiming(1 + motion.breathe, { duration: floatMs, easing: EASE_IN_OUT, reduceMotion: ReduceMotion.System }),
            withTiming(1 - motion.breathe * 0.4, { duration: floatMs, easing: EASE_IN_OUT, reduceMotion: ReduceMotion.System }),
          ),
          -1,
          true,
        ));
      }, breatheDelay);
      return () => {
        clearTimeout(timer);
        cancelAnimation(translateY);
        cancelAnimation(scale);
        cancelAnimation(rotate);
        cancelAnimation(opacity);
      };
    }

    if (motion.tilt > 0) {
      rotate.set(withRepeat(
        withSequence(
          withTiming(motion.tilt, { duration: floatMs * 1.1, easing: EASE_IN_OUT, reduceMotion: ReduceMotion.System }),
          withTiming(-motion.tilt, { duration: floatMs * 1.1, easing: EASE_IN_OUT, reduceMotion: ReduceMotion.System }),
        ),
        -1,
        true,
      ));
    }

    return () => {
      cancelAnimation(translateY);
      cancelAnimation(scale);
      cancelAnimation(rotate);
      cancelAnimation(opacity);
    };
  }, [state, reduced, translateY, scale, rotate, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [
      { translateY: translateY.get() },
      { rotate: `${rotate.get()}deg` },
      { scale: scale.get() },
    ],
  }));

  return (
    <Animated.View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Nimby, ${state}`}
      style={[styles.wrap, { width: size, height: size }, style, animatedStyle]}
    >
      <Animated.Image
        source={sprites[state]}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </Animated.View>
  );
}

/** Map scan lifecycle → mascot expression. */
export function mascotForScan(phase: string, hasResults = false): MascotState {
  switch (phase) {
    case 'preparing':
    case 'running':
    case 'matching':
      return 'scanning';
    case 'paused':
      return 'thinking';
    case 'complete':
      return hasResults ? 'success' : 'resting';
    case 'cancelled':
    case 'blocked':
      return 'resting';
    default:
      return 'idle';
  }
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
