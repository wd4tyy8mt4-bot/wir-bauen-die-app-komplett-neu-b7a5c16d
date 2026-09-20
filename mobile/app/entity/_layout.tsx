import { Stack } from 'expo-router';

export default function EntityLayout() {
  return (
    <Stack
      initialRouteName="[id]"
      screenOptions={{
        headerShown: false,
        headerBackButtonDisplayMode: 'minimal',
        animation: 'slide_from_right',
      }}
    />
  );
}
