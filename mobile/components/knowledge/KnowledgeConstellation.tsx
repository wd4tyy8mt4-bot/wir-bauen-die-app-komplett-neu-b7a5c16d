import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

import { EntityGlyph } from '@/components/design/EntityGlyph';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { palette, radii } from '@/theme/design';
import { formatEntityType } from '@/utils/presentation';
import type { EntityRecord } from '@/domain';

interface KnowledgeConstellationProps {
  entities: EntityRecord[];
  onSelect: (entity: EntityRecord) => void;
}

interface Point {
  x: number;
  y: number;
}

interface ConnectorProps {
  from: Point;
  to: Point;
  scale: number;
  progress: Animated.Value;
  pulse: Animated.Value;
  reduceMotion: boolean;
  emphasized: boolean;
}

interface NodeProps {
  entity: EntityRecord;
  x: number;
  y: number;
  scale: number;
  central?: boolean;
  selected: boolean;
  dimmed: boolean;
  accent: 'blue' | 'warm';
  onPress: () => void;
}

const STAGE_WIDTH = 330;
const STAGE_HEIGHT = 304;
const CENTER: Point = { x: 165, y: 151 };
const POSITIONS: readonly Point[] = [
  { x: 165, y: 43 },
  { x: 63, y: 100 },
  { x: 267, y: 105 },
  { x: 69, y: 221 },
  { x: 260, y: 220 },
];

function shortenTitle(title: string, maxLength: number): string {
  if (title.length <= maxLength) return title;
  const shortened = title.slice(0, maxLength + 1);
  const lastSpace = shortened.lastIndexOf(' ');
  const safeEnd = lastSpace >= Math.floor(maxLength * 0.58) ? lastSpace : maxLength;
  return `${title.slice(0, safeEnd).trim()}…`;
}

function Connector({ from, to, scale, progress, pulse, reduceMotion, emphasized }: ConnectorProps) {
  const dx = (to.x - from.x) * scale;
  const dy = (to.y - from.y) * scale;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const midpointX = ((from.x + to.x) / 2) * scale;
  const midpointY = ((from.y + to.y) / 2) * scale;
  const lightSize = Math.max(2, 3 * scale);
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-lightSize, length] });
  const connectorOpacity = reduceMotion
    ? emphasized ? 1 : 0.72
    : pulse.interpolate({
        inputRange: [0, 1],
        outputRange: emphasized ? [0.72, 1] : [0.58, 0.78],
      });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.connector,
        emphasized ? styles.connectorEmphasized : styles.connectorDimmed,
        {
          width: length,
          left: midpointX - length / 2,
          top: midpointY - StyleSheet.hairlineWidth / 2,
          opacity: connectorOpacity,
          transform: [{ rotate: `${angle}deg` }],
        },
      ]}
    >
      {!reduceMotion && emphasized ? (
        <Animated.View
          style={[
            styles.connectorLight,
            {
              width: lightSize,
              height: lightSize,
              borderRadius: lightSize / 2,
              opacity: progress.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 0.5, 0.5, 0] }),
              transform: [{ translateX }],
            },
          ]}
        />
      ) : null}
    </Animated.View>
  );
}

function Node({ entity, x, y, scale, central = false, selected, dimmed, accent, onPress }: NodeProps) {
  const width = (central ? 144 : 104) * scale;
  const height = (central ? 132 : 94) * scale;
  const glyphSize = Math.max(30, (central ? 72 : 40) * scale);
  const titleWidth = Math.max(72, (central ? 132 : 102) * scale);
  const visibleTitle = shortenTitle(entity.title, central ? 42 : 29);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${entity.title}, ${formatEntityType(entity.type)}${selected ? ', ausgewählt, erneut tippen zum Öffnen' : ''}`}
      style={({ pressed }) => [
        styles.node,
        central && styles.centralNode,
        selected && styles.selectedNode,
        dimmed && styles.dimmedNode,
        {
          width,
          minHeight: height,
          left: x * scale - width / 2,
          top: y * scale - height / 2,
          gap: Math.max(4, 6 * scale),
        },
        pressed && styles.nodePressed,
      ]}
    >
      {central || selected ? (
        <View
          pointerEvents="none"
          style={[
            styles.nodeHalo,
            selected && styles.selectedHalo,
            accent === 'warm' && styles.warmHalo,
            {
              width: glyphSize * (selected ? 1.5 : 1.38),
              height: glyphSize * (selected ? 1.5 : 1.38),
              borderRadius: glyphSize,
            },
          ]}
        />
      ) : null}
      <EntityGlyph type={entity.type} size={glyphSize} accent={accent} />
      <Text
        numberOfLines={2}
        ellipsizeMode="tail"
        style={[
          styles.nodeTitle,
          {
            maxWidth: titleWidth,
            fontSize: Math.max(9, (central ? 12 : 10) * scale),
            lineHeight: Math.max(12, (central ? 16 : 13) * scale),
          },
          central && styles.centralTitle,
          selected && styles.selectedTitle,
        ]}
      >
        {visibleTitle}
      </Text>
    </Pressable>
  );
}

export function KnowledgeConstellation({ entities, onSelect }: KnowledgeConstellationProps) {
  const reduceMotion = useReduceMotion();
  const [availableWidth, setAvailableWidth] = useState(0);
  const lightProgress = useRef(new Animated.Value(0)).current;
  const centerPulse = useRef(new Animated.Value(0)).current;
  const visible = useMemo(() => entities.slice(0, 6), [entities]);
  const [central, ...satellites] = visible;
  const [selectedId, setSelectedId] = useState<string | undefined>(central?.id);
  const stageWidth = Math.min(STAGE_WIDTH, availableWidth);
  const scale = stageWidth > 0 ? stageWidth / STAGE_WIDTH : 0;
  const stageHeight = STAGE_HEIGHT * scale;
  const selected = visible.find((entity) => entity.id === selectedId) ?? central;
  const selectedIsCentral = selected?.id === central?.id;

  useEffect(() => {
    if (!visible.some((entity) => entity.id === selectedId)) {
      setSelectedId(central?.id);
    }
  }, [central?.id, selectedId, visible]);

  useEffect(() => {
    lightProgress.stopAnimation();
    centerPulse.stopAnimation();

    if (reduceMotion) {
      lightProgress.setValue(0);
      centerPulse.setValue(0.4);
      return undefined;
    }

    lightProgress.setValue(0);
    centerPulse.setValue(0);
    const lightAnimation = Animated.loop(
      Animated.timing(lightProgress, {
        toValue: 1,
        duration: 11000,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }),
    );
    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(centerPulse, { toValue: 1, duration: 7600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(centerPulse, { toValue: 0, duration: 7600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );

    lightAnimation.start();
    pulseAnimation.start();
    return () => {
      lightAnimation.stop();
      pulseAnimation.stop();
    };
  }, [centerPulse, lightProgress, reduceMotion]);

  const handleLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.max(0, event.nativeEvent.layout.width);
    setAvailableWidth((currentWidth) => Math.abs(currentWidth - nextWidth) < 0.5 ? currentWidth : nextWidth);
  };

  const handleNodePress = (entity: EntityRecord) => {
    if (entity.id === selectedId) {
      onSelect(entity);
      return;
    }
    setSelectedId(entity.id);
  };

  if (!central) return null;

  return (
    <View style={styles.wrapper} onLayout={handleLayout}>
      {scale > 0 ? (
        <View style={[styles.stage, { width: stageWidth, height: stageHeight }]}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.centerGlow,
              {
                left: CENTER.x * scale - 78 * scale,
                top: CENTER.y * scale - 78 * scale,
                width: 156 * scale,
                height: 156 * scale,
                borderRadius: 78 * scale,
                opacity: reduceMotion
                  ? 0.5
                  : centerPulse.interpolate({ inputRange: [0, 1], outputRange: [0.38, 0.52] }),
                transform: [{
                  scale: reduceMotion
                    ? 1
                    : centerPulse.interpolate({ inputRange: [0, 1], outputRange: [0.995, 1.028] }),
                }],
              },
            ]}
          />

          {satellites.map((entity, index) => {
            const position = POSITIONS[index];
            const emphasized = selectedIsCentral || selected?.id === entity.id;
            return position ? (
              <Connector
                key={`line-${entity.id}`}
                from={CENTER}
                to={position}
                scale={scale}
                progress={lightProgress}
                pulse={centerPulse}
                reduceMotion={reduceMotion}
                emphasized={emphasized}
              />
            ) : null;
          })}

          {satellites.map((entity, index) => {
            const position = POSITIONS[index];
            const nodeSelected = selected?.id === entity.id;
            const dimmed = !selectedIsCentral && !nodeSelected;
            return position ? (
              <Node
                key={entity.id}
                entity={entity}
                x={position.x}
                y={position.y}
                scale={scale}
                selected={nodeSelected}
                dimmed={dimmed}
                accent={nodeSelected ? 'warm' : 'blue'}
                onPress={() => handleNodePress(entity)}
              />
            ) : null;
          })}

          <Node
            entity={central}
            x={CENTER.x}
            y={CENTER.y}
            scale={scale}
            central
            selected={selectedIsCentral}
            dimmed={false}
            accent="blue"
            onPress={() => handleNodePress(central)}
          />
        </View>
      ) : null}

      {selected ? (
        <Pressable
          onPress={() => onSelect(selected)}
          accessibilityRole="button"
          accessibilityLabel={`${selected.title} öffnen`}
          style={({ pressed }) => [styles.selectionCard, pressed && styles.selectionPressed]}
        >
          <View style={styles.selectionAccent} />
          <View style={styles.selectionCopy}>
            <Text style={styles.selectionTitle}>{selected.title}</Text>
            <Text style={styles.selectionMeta}>{formatEntityType(selected.type)} · Zum Öffnen tippen</Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    alignItems: 'center',
    overflow: 'hidden',
    paddingBottom: 14,
  },
  stage: {
    position: 'relative',
  },
  centerGlow: {
    position: 'absolute',
    backgroundColor: 'rgba(83, 137, 185, 0.1)',
    boxShadow: '0 0 38px rgba(83, 137, 185, 0.16)',
  },
  connector: {
    position: 'absolute',
    height: StyleSheet.hairlineWidth,
    overflow: 'visible',
  },
  connectorEmphasized: {
    backgroundColor: 'rgba(112, 157, 214, 0.34)',
  },
  connectorDimmed: {
    backgroundColor: 'rgba(145, 151, 163, 0.12)',
  },
  connectorLight: {
    position: 'absolute',
    top: -1,
    left: 0,
    backgroundColor: 'rgba(220, 236, 244, 0.9)',
    boxShadow: '0 0 6px rgba(112, 173, 214, 0.5)',
  },
  node: {
    position: 'absolute',
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centralNode: {
    zIndex: 3,
  },
  selectedNode: {
    zIndex: 4,
    transform: [{ scale: 1.04 }],
  },
  dimmedNode: {
    opacity: 0.24,
  },
  nodeHalo: {
    position: 'absolute',
    backgroundColor: 'rgba(72, 145, 255, 0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(132, 191, 255, 0.24)',
    boxShadow: '0 0 22px rgba(72, 145, 255, 0.2)',
  },
  selectedHalo: {
    backgroundColor: 'rgba(111, 167, 213, 0.13)',
    borderColor: 'rgba(197, 224, 239, 0.38)',
  },
  warmHalo: {
    backgroundColor: 'rgba(217, 163, 95, 0.1)',
    borderColor: 'rgba(217, 163, 95, 0.3)',
    boxShadow: '0 0 22px rgba(217, 163, 95, 0.16)',
  },
  nodePressed: {
    opacity: 0.72,
  },
  nodeTitle: {
    color: palette.textSecondary,
    textAlign: 'center',
  },
  centralTitle: {
    color: palette.text,
    fontWeight: '600',
  },
  selectedTitle: {
    color: palette.text,
    fontWeight: '600',
  },
  selectionCard: {
    width: '88%',
    minHeight: 58,
    marginTop: -4,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: 'rgba(255, 252, 247, 0.045)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  selectionAccent: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 2,
    backgroundColor: palette.warm,
  },
  selectionCopy: {
    flex: 1,
  },
  selectionTitle: {
    color: palette.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  selectionMeta: {
    marginTop: 3,
    color: palette.textTertiary,
    fontSize: 10,
  },
  selectionPressed: {
    opacity: 0.76,
  },
});
