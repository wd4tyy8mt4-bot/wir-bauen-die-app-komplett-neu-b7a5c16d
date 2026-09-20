import { useCallback, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { AppBackground } from '@/components/design/AppBackground';
import { GlassPanel } from '@/components/design/GlassPanel';
import { ScreenHeader } from '@/components/design/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { useApplicationServices } from '@/providers/ApplicationProvider';
import { palette, radii } from '@/theme/design';

interface MenuRowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  color: string;
  onPress?: () => void;
  isLast?: boolean;
}

function MenuRow({ icon, title, subtitle, color, onPress, isLast = false }: MenuRowProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.menuRow, !isLast && styles.menuDivider, pressed && styles.pressed]}
    >
      <View style={[styles.menuIcon, { backgroundColor: `${color}18` }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View style={styles.menuCopy}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuSubtitle}>{subtitle}</Text>
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={18} color={palette.textTertiary} /> : null}
    </Pressable>
  );
}

export default function MoreScreen() {
  const router = useRouter();
  const services = useApplicationServices();
  const [entityCount, setEntityCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  useFocusEffect(useCallback(() => {
    void Promise.all([services.listRecent(200), services.listPendingReviews()])
      .then(([entities, reviews]) => {
        setEntityCount(entities.length);
        setPendingCount(reviews.reduce((count, review) => count + review.proposals.filter((proposal) => proposal.status === 'PENDING').length, 0));
      })
      .catch(() => undefined);
  }, [services]));

  return (
    <AppBackground>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ScreenHeader title="Mehr" subtitle="Dein Gedächtnis, deine Kontrolle, deine Privatsphäre." />

          <GlassPanel style={styles.identityPanel} strong>
            <View style={styles.identityContent}>
              <View style={styles.aiMark}>
                <Ionicons name="sparkles" size={27} color={palette.text} />
              </View>
              <View style={styles.identityCopy}>
                <Text style={styles.identityTitle}>Deine persönliche KI</Text>
                <Text style={styles.identitySubtitle}>Für dich da · unter deiner Kontrolle</Text>
              </View>
              <View style={styles.activeDot} />
            </View>
            <View style={styles.stats}>
              <View style={styles.stat}><Text style={styles.statValue}>{entityCount}</Text><Text style={styles.statLabel}>Erinnerungen</Text></View>
              <View style={styles.statDivider} />
              <View style={styles.stat}><Text style={styles.statValue}>{pendingCount}</Text><Text style={styles.statLabel}>Offen</Text></View>
              <View style={styles.statDivider} />
              <View style={styles.stat}><Text style={styles.statValue}>Privat</Text><Text style={styles.statLabel}>Standard</Text></View>
            </View>
          </GlassPanel>

          <Text style={styles.sectionLabel}>DEIN GEDÄCHTNIS</Text>
          <GlassPanel style={styles.menuPanel}>
            <MenuRow icon="git-network" title="Wissensübersicht" subtitle="Informationen und Zusammenhänge entdecken" color={palette.blue} onPress={() => router.push('/(tabs)/knowledge')} />
            <MenuRow icon="checkmark-done" title="Vorschläge prüfen" subtitle={`${pendingCount} Informationen warten auf dich`} color={palette.violet} onPress={() => router.push('/review')} />
            <MenuRow icon="mic" title="Sprachaufnahmen" subtitle="Deine Aufnahmen werden privat verarbeitet" color={palette.cyan} onPress={() => router.push('/(tabs)')} isLast />
          </GlassPanel>

          <Text style={styles.sectionLabel}>DEINE PRIVATSPHÄRE</Text>
          <GlassPanel style={styles.menuPanel}>
            <MenuRow icon="lock-closed" title="Lokale Daten" subtitle="Deine Informationen bleiben standardmäßig privat" color={palette.success} />
            <MenuRow icon="shield-checkmark" title="Du entscheidest" subtitle="Vorschläge werden nie automatisch übernommen" color={palette.blue} />
            <MenuRow icon="layers" title="Offen für Neues" subtitle="Deine KI ordnet neue Dinge selbstständig ein" color={palette.warm} isLast />
          </GlassPanel>

          <Text style={styles.footer}>Appifex · Dein Wissen. Dein Leben.</Text>
        </ScrollView>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 125 },
  identityPanel: { marginTop: 22, borderRadius: radii.xl },
  identityContent: { padding: 18, flexDirection: 'row', alignItems: 'center', gap: 13 },
  aiMark: { width: 54, height: 54, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(82, 121, 255, 0.24)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(133, 177, 255, 0.38)', boxShadow: '0 0 22px rgba(75, 112, 255, 0.22)' },
  identityCopy: { flex: 1 },
  identityTitle: { color: palette.text, fontSize: 16, fontWeight: '600' },
  identitySubtitle: { marginTop: 4, color: palette.textTertiary, fontSize: 10 },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.success },
  stats: { minHeight: 68, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border, flexDirection: 'row', alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center', gap: 3 },
  statValue: { color: palette.text, fontSize: 14, fontWeight: '600' },
  statLabel: { color: palette.textTertiary, fontSize: 9 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: palette.border },
  sectionLabel: { marginTop: 27, marginBottom: 9, marginLeft: 4, color: palette.textTertiary, fontSize: 9, fontWeight: '600', letterSpacing: 0.9 },
  menuPanel: { borderRadius: radii.lg },
  menuRow: { minHeight: 70, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  menuDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  menuIcon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  menuCopy: { flex: 1 },
  menuTitle: { color: palette.text, fontSize: 13, fontWeight: '500' },
  menuSubtitle: { marginTop: 4, color: palette.textTertiary, fontSize: 10 },
  pressed: { backgroundColor: 'rgba(255, 255, 255, 0.035)' },
  footer: { marginTop: 30, color: palette.textTertiary, fontSize: 10, textAlign: 'center' },
});
