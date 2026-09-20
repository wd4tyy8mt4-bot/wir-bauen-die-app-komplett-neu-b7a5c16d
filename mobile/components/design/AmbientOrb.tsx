import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useReduceMotion } from '@/hooks/useReduceMotion';

export type AmbientOrbState = 'idle' | 'listening' | 'processing' | 'ready';

interface AmbientOrbProps {
  compact?: boolean;
  state?: AmbientOrbState;
  active?: boolean;
  audioLevel?: number;
}

const STATE_COLORS: Record<AmbientOrbState, readonly [string, string, string, string]> = {
  idle: ['#DDE8EE', '#8EB7CF', '#4E7597', '#172A42'],
  listening: ['#FFF0C2', '#F3B75D', '#9D6743', '#315D7F'],
  processing: ['#C9F0FF', '#62B8F4', '#3F6FD8', '#243865'],
  ready: ['#F8FBFF', '#B8E9FF', '#6FAEFF', '#E5B96A'],
};

const STATE_TIMING: Record<AmbientOrbState, number> = {
  idle: 6200,
  listening: 1700,
  processing: 2100,
  ready: 1050,
};

export function AmbientOrb({
  compact = false,
  state,
  active = false,
  audioLevel,
}: AmbientOrbProps) {
  const reduceMotion = useReduceMotion();
  const resolvedState = state ?? (active ? 'listening' : 'idle');
  const breath = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const energy = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;

  const level = Math.max(0, Math.min(1, audioLevel ?? 0));
  const hasAudioMetering = typeof audioLevel === 'number';
  const size = compact ? 132 : 188;
  const stageSize = size * 1.52;
  const timing = STATE_TIMING[resolvedState];

  useEffect(() => {
    breath.stopAnimation();
    drift.stopAnimation();
    shimmer.stopAnimation();
    energy.stopAnimation();
    orbit.stopAnimation();

    if (reduceMotion) {
      breath.setValue(
        resolvedState === 'ready'
          ? 0.66
          : resolvedState === 'listening'
            ? 0.42
            : resolvedState === 'processing'
              ? 0.36
              : 0.24,
      );
      drift.setValue(0.5);
      shimmer.setValue(
        resolvedState === 'ready'
          ? 0.72
          : resolvedState === 'processing'
            ? 0.58
            : resolvedState === 'listening'
              ? 0.5
              : 0.3,
      );
      energy.setValue(resolvedState === 'listening' ? 0.44 : resolvedState === 'ready' ? 0.32 : 0.18);
      orbit.setValue(resolvedState === 'processing' ? 0.62 : 0.5);
      return undefined;
    }

    breath.setValue(0);
    drift.setValue(0);
    shimmer.setValue(0);
    energy.setValue(0);
    orbit.setValue(0);

    if (resolvedState === 'ready') {
      const readyBloom = Animated.parallel([
        Animated.sequence([
          Animated.timing(breath, {
            toValue: 1,
            duration: 420,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(breath, {
            toValue: 0.42,
            duration: 680,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(shimmer, {
            toValue: 1,
            duration: 360,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(shimmer, {
            toValue: 0.48,
            duration: 740,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(energy, {
            toValue: 0.78,
            duration: 300,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(energy, {
            toValue: 0.24,
            duration: 800,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ]);

      readyBloom.start();
      return () => readyBloom.stop();
    }

    const animations: Animated.CompositeAnimation[] = [
      Animated.loop(
        Animated.sequence([
          Animated.timing(breath, {
            toValue: 1,
            duration: timing,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(breath, {
            toValue: 0,
            duration: timing,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      ),
    ];

    if (resolvedState === 'idle') {
      animations.push(
        Animated.loop(
          Animated.sequence([
            Animated.timing(drift, {
              toValue: 1,
              duration: 8400,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
            Animated.timing(drift, {
              toValue: 0,
              duration: 7600,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
          ]),
        ),
        Animated.loop(
          Animated.sequence([
            Animated.timing(shimmer, {
              toValue: 1,
              duration: 5200,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
            Animated.timing(shimmer, {
              toValue: 0,
              duration: 6100,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
          ]),
        ),
      );
    }

    if (resolvedState === 'listening') {
      animations.push(
        Animated.loop(
          Animated.sequence([
            Animated.timing(drift, {
              toValue: 1,
              duration: 1900,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(drift, {
              toValue: 0,
              duration: 2300,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        ),
        Animated.loop(
          Animated.sequence([
            Animated.timing(shimmer, {
              toValue: 1,
              duration: 720,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(shimmer, {
              toValue: 0.18,
              duration: 1080,
              easing: Easing.inOut(Easing.sin),
              useNativeDriver: true,
            }),
          ]),
        ),
      );

      if (!hasAudioMetering) {
        animations.push(
          Animated.loop(
            Animated.sequence([
              Animated.timing(energy, { toValue: 0.28, duration: 240, easing: Easing.out(Easing.quad), useNativeDriver: true }),
              Animated.timing(energy, { toValue: 0.72, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
              Animated.timing(energy, { toValue: 0.18, duration: 290, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
              Animated.timing(energy, { toValue: 0.92, duration: 460, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
              Animated.timing(energy, { toValue: 0.36, duration: 330, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
              Animated.timing(energy, { toValue: 0.58, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
              Animated.timing(energy, { toValue: 0.12, duration: 520, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            ]),
          ),
        );
      } else {
        energy.setValue(0.2);
      }
    }

    if (resolvedState === 'processing') {
      animations.push(
        Animated.loop(
          Animated.timing(orbit, {
            toValue: 1,
            duration: 4600,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        ),
        Animated.loop(
          Animated.sequence([
            Animated.timing(shimmer, {
              toValue: 1,
              duration: 860,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(shimmer, {
              toValue: 0.12,
              duration: 1240,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        ),
      );
    }

    animations.forEach((animation) => animation.start());
    return () => animations.forEach((animation) => animation.stop());
  }, [breath, drift, energy, hasAudioMetering, orbit, reduceMotion, resolvedState, shimmer, timing]);

  useEffect(() => {
    if (reduceMotion || resolvedState !== 'listening' || !hasAudioMetering) return undefined;

    const meterResponse = Animated.timing(energy, {
      toValue: Math.max(0.08, level),
      duration: 150,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    meterResponse.start();
    return () => meterResponse.stop();
  }, [energy, hasAudioMetering, level, reduceMotion, resolvedState]);

  const motion = useMemo(() => {
    const listeningEnergy = hasAudioMetering ? level : 0;

    return {
      scale:
        resolvedState === 'listening'
          ? energy.interpolate({
              inputRange: [0, 1],
              outputRange: [0.992 + listeningEnergy * 0.01, 1.045 + listeningEnergy * 0.055],
            })
          : breath.interpolate({
              inputRange: [0, 1],
              outputRange:
                resolvedState === 'processing'
                  ? [0.994, 1.018]
                  : resolvedState === 'ready'
                    ? [0.99, 1.075]
                    : [0.992, 1.018],
            }),
      glowScale:
        resolvedState === 'listening'
          ? energy.interpolate({
              inputRange: [0, 1],
              outputRange: [0.96, 1.16 + listeningEnergy * 0.08],
            })
          : breath.interpolate({
              inputRange: [0, 1],
              outputRange: [0.96, resolvedState === 'ready' ? 1.2 : 1.09],
            }),
      shapeScaleX:
        resolvedState === 'listening'
          ? energy.interpolate({ inputRange: [0, 1], outputRange: [0.988, 1.024] })
          : drift.interpolate({ inputRange: [0, 1], outputRange: [0.99, 1.012] }),
      shapeScaleY:
        resolvedState === 'listening'
          ? energy.interpolate({ inputRange: [0, 1], outputRange: [1.014, 0.982] })
          : drift.interpolate({ inputRange: [0, 1], outputRange: [1.01, 0.988] }),
      glowOpacity: shimmer.interpolate({
        inputRange: [0, 1],
        outputRange:
          resolvedState === 'idle'
            ? [0.2, 0.38]
            : resolvedState === 'listening'
              ? [0.34, 0.7]
              : resolvedState === 'processing'
                ? [0.3, 0.64]
                : [0.36, 0.78],
      }),
      translateX: drift.interpolate({
        inputRange: [0, 1],
        outputRange: resolvedState === 'idle' ? [-size * 0.022, size * 0.022] : [-size * 0.035, size * 0.035],
      }),
      translateY: breath.interpolate({
        inputRange: [0, 1],
        outputRange: resolvedState === 'idle' ? [size * 0.012, -size * 0.012] : [size * 0.018, -size * 0.018],
      }),
      innerRotation:
        resolvedState === 'processing'
          ? orbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] })
          : drift.interpolate({ inputRange: [0, 1], outputRange: ['-7deg', '9deg'] }),
      counterRotation:
        resolvedState === 'processing'
          ? orbit.interpolate({ inputRange: [0, 1], outputRange: ['360deg', '0deg'] })
          : drift.interpolate({ inputRange: [0, 1], outputRange: ['8deg', '-6deg'] }),
      lightCoreScale:
        resolvedState === 'ready'
          ? energy.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.2] })
          : resolvedState === 'listening'
            ? energy.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.13] })
            : breath.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.045] }),
      lightCoreOpacity:
        resolvedState === 'ready'
          ? energy.interpolate({ inputRange: [0, 1], outputRange: [0.52, 0.96] })
          : resolvedState === 'listening'
            ? energy.interpolate({ inputRange: [0, 1], outputRange: [0.52, 0.9] })
            : shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.78] }),
      lightCoreTranslateX: drift.interpolate({
        inputRange: [0, 1],
        outputRange: [-size * 0.045, size * 0.045],
      }),
      lightCoreTranslateY: shimmer.interpolate({
        inputRange: [0, 1],
        outputRange: [size * 0.022, -size * 0.032],
      }),
      veilOpacity: shimmer.interpolate({
        inputRange: [0, 1],
        outputRange: [0.18, resolvedState === 'ready' ? 0.58 : 0.44],
      }),
      coreOpacity:
        resolvedState === 'listening'
          ? energy.interpolate({ inputRange: [0, 1], outputRange: [0.16, 0.52] })
          : shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.14, 0.34] }),
      orbitRotation: orbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }),
    };
  }, [breath, drift, energy, hasAudioMetering, level, orbit, resolvedState, shimmer, size]);

  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.stage, { width: stageSize, height: stageSize }]}
    >
      <View
        style={[
          styles.spatialHalo,
          {
            width: size * 1.62,
            height: size * 1.62,
            borderRadius: size,
          },
        ]}
      />

      <Animated.View
        style={[
          styles.ambientGlow,
          {
            width: size * 1.42,
            height: size * 1.42,
            borderRadius: size,
            opacity: motion.glowOpacity,
            transform: [{ scale: motion.glowScale }],
          },
        ]}
      />

      <Animated.View
        style={[
          styles.orbShell,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            transform: [
              { translateX: motion.translateX },
              { translateY: motion.translateY },
              { scale: motion.scale },
              { scaleX: motion.shapeScaleX },
              { scaleY: motion.shapeScaleY },
            ],
          },
        ]}
      >
        <LinearGradient
          colors={STATE_COLORS[resolvedState]}
          locations={[0, 0.34, 0.7, 1]}
          start={{ x: 0.08, y: 0.05 }}
          end={{ x: 0.92, y: 0.95 }}
          style={StyleSheet.absoluteFill}
        />

        <Animated.View
          style={[
            styles.materialCore,
            {
              opacity: motion.coreOpacity,
              transform: [
                { rotate: motion.orbitRotation },
                { scale: resolvedState === 'processing' ? 1.08 : 1 },
              ],
            },
          ]}
        >
          <LinearGradient
            colors={
              resolvedState === 'listening'
                ? ['rgba(255,244,204,0.72)', 'rgba(240,167,68,0.3)', 'rgba(27,71,111,0.02)']
                : ['rgba(235,249,255,0.72)', 'rgba(77,172,255,0.28)', 'rgba(19,49,91,0.02)']
            }
            start={{ x: 0.12, y: 0.18 }}
            end={{ x: 0.88, y: 0.82 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.lightCore,
            {
              opacity: motion.lightCoreOpacity,
              transform: [
                { translateX: motion.lightCoreTranslateX },
                { translateY: motion.lightCoreTranslateY },
                { scale: motion.lightCoreScale },
              ],
            },
          ]}
        >
          <LinearGradient
            colors={[
              'rgba(255,252,239,0.92)',
              'rgba(255,239,207,0.42)',
              'rgba(255,255,255,0)',
            ]}
            locations={[0, 0.46, 1]}
            start={{ x: 0.28, y: 0.2 }}
            end={{ x: 0.78, y: 0.86 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.colorCloud,
            styles.colorCloudTop,
            { opacity: motion.veilOpacity, transform: [{ rotate: motion.innerRotation }] },
          ]}
        >
          <LinearGradient
            colors={['rgba(255,255,255,0.78)', 'rgba(164,222,249,0.16)', 'rgba(4,13,28,0.04)']}
            start={{ x: 0.1, y: 0.1 }}
            end={{ x: 0.9, y: 0.95 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.colorCloud,
            styles.colorCloudBottom,
            { opacity: motion.glowOpacity, transform: [{ rotate: motion.counterRotation }] },
          ]}
        >
          <LinearGradient
            colors={['rgba(35,103,158,0.04)', 'rgba(241,177,82,0.3)', 'rgba(81,167,232,0.1)']}
            start={{ x: 0.1, y: 0.8 }}
            end={{ x: 0.92, y: 0.15 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        <View style={styles.innerShade}>
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(7,20,39,0.02)', 'rgba(2,8,19,0.34)']}
            locations={[0, 0.58, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>
        <LinearGradient
          colors={['rgba(255,255,255,0.42)', 'rgba(255,255,255,0.05)', 'rgba(3,9,20,0.2)']}
          locations={[0, 0.34, 1]}
          start={{ x: 0.15, y: 0.02 }}
          end={{ x: 0.82, y: 0.98 }}
          style={styles.glassVeil}
        />
        <View style={styles.specular} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  spatialHalo: {
    position: 'absolute',
    backgroundColor: 'rgba(238, 226, 202, 0.035)',
    boxShadow: '0 0 96px rgba(228, 211, 181, 0.18)',
  },
  ambientGlow: {
    position: 'absolute',
    backgroundColor: 'rgba(223, 225, 218, 0.11)',
    boxShadow: '0 0 78px rgba(230, 218, 194, 0.22)',
  },
  orbShell: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(231, 244, 250, 0.48)',
    boxShadow: '0 20px 68px rgba(19, 70, 120, 0.34)',
  },
  materialCore: {
    position: 'absolute',
    width: '82%',
    height: '82%',
    left: '9%',
    top: '9%',
    borderRadius: 999,
    overflow: 'hidden',
  },
  innerShade: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    overflow: 'hidden',
  },
  lightCore: {
    position: 'absolute',
    width: '42%',
    height: '42%',
    left: '29%',
    top: '27%',
    borderRadius: 999,
    overflow: 'hidden',
    boxShadow: '0 0 34px rgba(255, 239, 207, 0.32)',
  },
  colorCloud: {
    position: 'absolute',
    overflow: 'hidden',
  },
  colorCloudTop: {
    width: '112%',
    height: '72%',
    left: '-18%',
    top: '-10%',
    borderRadius: 999,
  },
  colorCloudBottom: {
    width: '108%',
    height: '66%',
    right: '-24%',
    bottom: '-15%',
    borderRadius: 999,
  },
  glassVeil: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
  },
  specular: {
    position: 'absolute',
    width: '39%',
    height: '11%',
    top: '13%',
    left: '17%',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.34)',
    transform: [{ rotate: '-24deg' }],
    boxShadow: '0 0 18px rgba(255,255,255,0.16)',
  },
});
