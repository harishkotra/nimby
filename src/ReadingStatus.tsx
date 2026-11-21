import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { color, styles, useReducedMotion } from './ui';

export function ReadingStatus({ label }: { label: string }) {
  const reduced = useReducedMotion();
  const angle = useSharedValue(0);
  useEffect(() => {
    if (reduced) angle.value = 0;
    else angle.value = withRepeat(withTiming(360, { duration: 850, easing: Easing.linear }), -1);
    return () => cancelAnimation(angle);
  }, [angle, reduced]);
  const motion = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.value}deg` }] }));
  return <View style={layout.row} accessibilityLiveRegion="polite">
    <Animated.View accessible={false} importantForAccessibility="no" style={[layout.ring, motion]} />
    <Text style={[styles.body, layout.label]}>{label}</Text>
  </View>;
}

const layout = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 28 },
  ring: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: color.rule, borderTopColor: color.blue },
  label: { flex: 1 },
});
