import { useEffect, useRef } from 'react';
import type { PropsWithChildren } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';

import { useReduceMotion } from '@/hooks/useReduceMotion';
import { palette, radii } from '@/theme/design';

interface GlassPanelProps extends PropsWithChildren {
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  strong?: boolean;
  animatedHighlight?: boolean;
}

export function GlassPanel({
  children,
  style,
  intensity = 40,
  strong = false,
  animatedHighlight = false,
}: GlassPanelProps) {
  const reduceMotion = useReduceMotion();
  const reflection = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    reflection.stopAnimation();

    if (!animatedHighlight || reduceMotion) {
      reflection.setValue(0.45);
      return undefined;
    }

    reflection.setValue(0);
    const reflectionLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(reflection, {
          toValue: 1,
          duration: 9000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.delay(8000),
      ]),
    );

    reflectionLoop.start();

    return () => {
      reflectionLoop.stop();
      reflection.stopAnimation();
    };
  }, [animatedHighlight, reduceMotion, reflection]);

  const highlightOpacity = animatedHighlight
    ? reflection.interpolate({
        inputRange: [0, 0.45, 1],
        outputRange: [0.48, 0.78, 0.5],
      })
    : 0.58;
  const reflectionOpacity = animatedHighlight
    ? reflection.interpolate({
        inputRange: [0, 0.18, 0.5, 0.82, 1],
        outputRange: [0, 0.05, 0.11, 0.045, 0],
      })
    : 0;
  const reflectionTranslateX = reflection.interpolate({
    inputRange: [0, 1],
    outputRange: [-190, 430],
  });

  return (
    <View style={[styles.shell, strong && styles.strongShell, style]}>
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,252,247,0.055)', 'rgba(175,154,137,0.018)', 'rgba(0,0,0,0.035)']}
        locations={[0, 0.48, 1]}
        start={{ x: 0.08, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.reflection,
          {
            opacity: reflectionOpacity,
            transform: [{ translateX: reflectionTranslateX }, { rotate: '13deg' }],
          },
        ]}
      />
      <Animated.View pointerEvents="none" style={[styles.highlight, { opacity: highlightOpacity }]} />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    overflow: 'hidden',
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    backgroundColor: palette.surface,
    boxShadow: '0 12px 34px rgba(0, 0, 0, 0.28)',
  },
  strongShell: {
    borderColor: palette.borderStrong,
    backgroundColor: palette.surfaceStrong,
    boxShadow: '0 18px 44px rgba(0, 0, 0, 0.36)',
  },
  reflection: {
    position: 'absolute',
    top: -48,
    bottom: -48,
    width: 92,
    backgroundColor: 'rgba(255, 248, 238, 0.72)',
    boxShadow: '0 0 34px rgba(255, 242, 224, 0.18)',
  },
  highlight: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    height: 1,
    backgroundColor: palette.glassHighlight,
  },
  content: {
    flex: 1,
  },
});
