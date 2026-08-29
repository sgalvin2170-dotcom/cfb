import { Tabs } from 'expo-router';

export default function DashboardTabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: '#0b1d3a' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: '#0b1d3a',
        tabBarInactiveTintColor: '#8b949e',
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'CFB Games', tabBarLabel: 'CFB Games' }} />
      <Tabs.Screen name="best-bets" options={{ title: 'Best Bets', tabBarLabel: 'Best Bets' }} />
      <Tabs.Screen name="post-game" options={{ title: 'Post-Game Analysis', tabBarLabel: 'Post-Game' }} />
    </Tabs>
  );
}
