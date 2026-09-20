import { useEffect, useRef } from 'react';
import type { PropsWithChildren } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useReduceMotion } from '@/hooks/useReduceMotion';

export function AppBackground({ children }: PropsWithChildren) {
  const reduceMotion = useReduceMotion();
  const ambient = useRef(new Animated.Value(0)).current;
  const secondary = useRef(new Animated.Value(0)).current;
  const warm = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    ambient.stopAnimation();
    secondary.stopAnimation();
    warm.stopAnimation();

    if (reduceMotion) {
      ambient.setValue(0.46);
      secondary.setValue(0.38);
      warm.setValue(0.62);
      return undefined;
    }

    const primaryLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(ambient, {
          toValue: 1,
          duration: 18000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(ambient, {
          toValue: 0,
          duration: 21000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    const secondaryLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(secondary, {
          toValue: 1,
          duration: 24000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(secondary, {
          toValue: 0,
          duration: 19000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );

    const warmLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(warm, {
          toValue: 1,
          duration: 27000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(warm, {
          toValue: 0,
          duration: 23000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    primaryLoop.start();
    secondaryLoop.start();
    warmLoop.start();

    return () => {
      primaryLoop.stop();
      secondaryLoop.stop();
      warmLoop.stop();
      ambient.stopAnimation();
      secondary.stopAnimation();
      warm.stopAnimation();
    };
  }, [ambient, reduceMotion, secondary, warm]);

  const primaryTranslateX = ambient.interpolate({ inputRange: [0, 1], outputRange: [-30, 36] });
  const primaryTranslateY = ambient.interpolate({ inputRange: [0, 1], outputRange: [-18, 38] });
  const primaryScale = ambient.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.085] });
  const primaryOpacity = ambient.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] });
  const secondaryTranslateX = secondary.interpolate({ inputRange: [0, 1], outputRange: [26, -34] });
  const secondaryTranslateY = secondary.interpolate({ inputRange: [0, 1], outputRange: [20, -32] });
  const secondaryScale = secondary.interpolate({ inputRange: [0, 1], outputRange: [1.025, 0.97] });
  const secondaryOpacity = secondary.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.49] });
  const warmTranslateX = warm.interpolate({ inputRange: [0, 1], outputRange: [-14, 24] });
  const warmTranslateY = warm.interpolate({ inputRange: [0, 1], outputRange: [15, -21] });
  const warmScale = warm.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.075] });
  const warmOpacity = warm.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.37] });

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['#080808', '#141313', '#080709']}
        locations={[0, 0.52, 1]}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(244,238,226,0.065)', 'rgba(111,91,124,0.025)', 'rgba(0,0,0,0.20)']}
        locations={[0, 0.42, 1]}
        style={StyleSheet.absoluteFill}
      />

      <Animated.View
        pointerEvents="none"
        style={[
          styles.aurora,
          styles.auroraPrimary,
          {
            opacity: primaryOpacity,
            transform: [
              { translateX: primaryTranslateX },
              { translateY: primaryTranslateY },
              { scale: primaryScale },
            ],
          },
        ]}
      >
        <LinearGradient
          colors={['rgba(242,232,214,0.24)', 'rgba(126,101,145,0.12)', 'rgba(9,9,10,0)']}
          start={{ x: 0.18, y: 0.05 }}
          end={{ x: 0.84, y: 0.95 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.aurora,
          styles.auroraSecondary,
          {
            opacity: secondaryOpacity,
            transform: [
              { translateX: secondaryTranslateX },
              { translateY: secondaryTranslateY },
              { scale: secondaryScale },
            ],
          },
        ]}
      >
        <LinearGradient
          colors={['rgba(126,96,148,0.18)', 'rgba(224,215,204,0.10)', 'rgba(9,9,10,0)']}
          start={{ x: 0.82, y: 0.08 }}
          end={{ x: 0.14, y: 0.9 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.aurora,
          styles.auroraWarm,
          {
            opacity: warmOpacity,
            transform: [
              { translateX: warmTranslateX },
              { translateY: warmTranslateY },
              { scale: warmScale },
            ],
          },
        ]}
      >
        <LinearGradient
          colors={['rgba(231,172,91,0.22)', 'rgba(232,219,199,0.09)', 'rgba(9,9,10,0)']}
          start={{ x: 0.25, y: 0.15 }}
          end={{ x: 0.75, y: 0.9 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <View pointerEvents="none" style={styles.topGlow} />
      <View pointerEvents="none" style={styles.lowGlow} />
      <View pointerEvents="none" style={styles.horizonVeil} />
      <View pointerEvents="none" style={styles.atmosphere}>
        <View style={[styles.particle, styles.particleOne]} />
        <View style={[styles.particle, styles.particleTwo]} />
        <View style={[styles.particle, styles.particleThree]} />
      </View>
      <View pointerEvents="none" style={styles.edgeShade} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#090809',
  },
  aurora: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: 999,
  },
  auroraPrimary: {
    width: 430,
    height: 430,
    left: -175,
    top: -115,
  },
  auroraSecondary: {
    width: 390,
    height: 390,
    right: -205,
    top: '24%',
  },
  auroraWarm: {
    width: 360,
    height: 280,
    left: -95,
    bottom: -125,
  },
  topGlow: {
    position: 'absolute',
    width: 250,
    height: 250,
    borderRadius: 999,
    right: -120,
    top: -105,
    backgroundColor: 'rgba(238, 229, 215, 0.09)',
    boxShadow: '0 0 120px rgba(225, 211, 194, 0.14)',
  },
  lowGlow: {
    position: 'absolute',
    width: 330,
    height: 330,
    borderRadius: 999,
    left: -185,
    bottom: -185,
    backgroundColor: 'rgba(221, 157, 82, 0.085)',
    boxShadow: '0 0 130px rgba(221, 157, 82, 0.13)',
  },
  horizonVeil: {
    position: 'absolute',
    left: '-10%',
    right: '-10%',
    top: '38%',
    height: 220,
    borderRadius: 999,
    backgroundColor: 'rgba(135, 112, 145, 0.045)',
    boxShadow: '0 0 120px rgba(184, 158, 174, 0.075)',
  },
  edgeShade: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 24,
    borderColor: 'rgba(3, 2, 4, 0.12)',
  },
  atmosphere: {
    ...StyleSheet.absoluteFillObject,
  },
  particle: {
    position: 'absolute',
    width: 2,
    height: 2,
    borderRadius: 2,
    backgroundColor: 'rgba(239, 230, 215, 0.38)',
    boxShadow: '0 0 9px rgba(224, 205, 181, 0.28)',
  },
  particleOne: {
    top: '18%',
    right: '22%',
  },
  particleTwo: {
    top: '46%',
    left: '11%',
    opacity: 0.58,
  },
  particleThree: {
    bottom: '24%',
    right: '14%',
    opacity: 0.42,
  },
});
