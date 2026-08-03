import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function WeekSelector({
  weeks,
  selectedWeek,
  onSelect,
}: {
  weeks: number[];
  selectedWeek: number | undefined;
  onSelect: (week: number) => void;
}) {
  if (weeks.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {weeks.map((week) => {
          const active = week === selectedWeek;
          return (
            <Pressable
              key={week}
              onPress={() => onSelect(week)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>Week {week}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#0b1d3a',
    paddingVertical: 8,
  },
  row: {
    paddingHorizontal: 12,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  chipActive: {
    backgroundColor: '#fff',
  },
  chipText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  chipTextActive: {
    color: '#0b1d3a',
  },
});
