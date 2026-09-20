import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { BottomTabBar } from '@react-navigation/bottom-tabs';
import type { BottomTabBarProps, BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/theme/design';

type IconName = ComponentProps<typeof Ionicons>['name'];
type ExpoRouterTabOptions = BottomTabNavigationOptions & { href?: string | null };

function isRouteVisibleInTabBar(route: BottomTabBarProps['state']['routes'][number], descriptors: BottomTabBarProps['descriptors']) {
  const options = descriptors[route.key]?.options as ExpoRouterTabOptions | undefined;
  return options?.href !== null;
}

function GlassTabBar(props: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const visibleRoutes = props.state.routes.filter((route) => isRouteVisibleInTabBar(route, props.descriptors));

  if (visibleRoutes.length <= 1) {
    return <View style={{ paddingBottom: insets.bottom }} />;
  }

  return <BottomTabBar {...props} />;
}

function tabIcon(name: IconName, focusedName: IconName) {
  function TabBarIcon({ color, size, focused }: { color: string; size: number; focused: boolean }) {
    return <Ionicons name={focused ? focusedName : name} color={color} size={size} />;
  }
  return TabBarIcon;
}

export default function TabLayout() {
  return (
    <Tabs
      initialRouteName="index"
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: styles.scene,
        tabBarActiveTintColor: palette.blue,
        tabBarInactiveTintColor: palette.textTertiary,
        tabBarLabelStyle: styles.label,
        tabBarStyle: styles.bar,
        tabBarItemStyle: styles.item,
        tabBarActiveBackgroundColor: 'transparent',
        tabBarHideOnKeyboard: true,
        tabBarAllowFontScaling: false,
        tabBarBackground: () => (
          <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill}>
            <View style={styles.glassTint} />
          </BlurView>
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: tabIcon('home-outline', 'home') }}
      />
      <Tabs.Screen
        name="knowledge"
        options={{ title: 'Wissen', tabBarIcon: tabIcon('git-network-outline', 'git-network') }}
      />
      <Tabs.Screen
        name="tasks"
        options={{ title: 'Aufgaben', tabBarIcon: tabIcon('checkbox-outline', 'checkbox') }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'Mehr', tabBarIcon: tabIcon('menu-outline', 'menu') }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  scene: {
    backgroundColor: palette.background,
  },
  bar: {
    position: 'absolute',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 242, 224, 0.24)',
    backgroundColor: 'transparent',
    height: 78,
    paddingTop: 6,
    boxShadow: '0 -1px 0 rgba(255, 248, 238, 0.08), 0 -12px 36px rgba(24, 18, 14, 0.22)',
  },
  glassTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(46, 39, 33, 0.28)',
  },
  item: {
    marginHorizontal: 2,
    marginVertical: 3,
    paddingVertical: 2,
    borderRadius: 12,
  },
  label: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0,
  },
});
