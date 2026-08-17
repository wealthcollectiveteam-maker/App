import { useRouter } from 'expo-router';
import { CaretLeftIcon as CaretLeft } from 'phosphor-react-native';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, font, space } from '@/theme/tokens';

/** Placeholder legal page until counsel-approved copy lands. */
export function LegalPage({
  title,
  paragraphs,
}: {
  title: string;
  paragraphs: string[];
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 10 }]}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <CaretLeft size={20} color={colors.neutral400} />
        </Pressable>
        <Text style={styles.title}>{title}</Text>
        <View style={{ width: 20 }} />
      </View>
      {paragraphs.map((p, i) => (
        <Text key={i} style={styles.body}>
          {p}
        </Text>
      ))}
      <Text style={styles.placeholder}>
        Placeholder copy — replace with counsel-approved text before release.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: space.screenX,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    fontFamily: font.medium,
    fontSize: 20,
    color: colors.text,
  },
  body: {
    fontFamily: font.regular,
    fontSize: 13.5,
    color: colors.neutral300,
    lineHeight: 20,
    marginBottom: 14,
  },
  placeholder: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.neutral600,
    marginTop: 8,
    fontStyle: 'italic',
  },
});
