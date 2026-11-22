import { useEffect, useRef } from 'react';
import { Image, StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation, Easing, interpolate, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { color } from './ui';

const logo = { uri: 'splashscreen_logo', width: 288, height: 288 };
const easeOut = Easing.bezier(0.23, 1, 0.32, 1);

export function LaunchSplash({ onFinish }: { onFinish: () => void }) {
  const reduced = useReducedMotion();
  const started = useRef(false);
  const progress = useSharedValue(0);

  useEffect(() => () => cancelAnimation(progress), [progress]);

  function reveal() {
    if (started.current) return;
    started.current = true;
    progress.set(withTiming(1, { duration: reduced ? 120 : 260, easing: easeOut, reduceMotion: ReduceMotion.Never }, (done) => {
      if (done) scheduleOnRN(onFinish);
    }));
  }

  const curtain = useAnimatedStyle(() => ({ opacity: interpolate(progress.get(), [0, 0.5, 1], [1, 1, 0]) }));
  const motion = useAnimatedStyle(() => ({
    transform: [{ translateY: reduced ? 0 : -8 * progress.get() }, { scale: reduced ? 1 : 1 + 0.04 * progress.get() }],
  }));

  return <Animated.View pointerEvents="none" importantForAccessibility="no-hide-descendants"
    style={[StyleSheet.absoluteFill, layout.curtain, curtain]}>
    <Animated.View style={motion}>
      <Image source={logo} style={layout.logo} resizeMode="contain" fadeDuration={0} onLoad={reveal} onError={onFinish} />
    </Animated.View>
  </Animated.View>;
}

const layout = StyleSheet.create({
  curtain: { backgroundColor: color.paper, alignItems: 'center', justifyContent: 'center' },
  logo: { width: logo.width, height: logo.height },
});
