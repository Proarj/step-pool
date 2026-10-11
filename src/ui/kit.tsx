import type { ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from './theme';

export function Screen({ children, refreshing, onRefresh }: {
  children: ReactNode; refreshing?: boolean; onRefresh?: () => void;
}) {
  const t = useTheme();
  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: t.background }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.card, borderColor: t.border, borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 }}>
      {children}
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 28, fontWeight: '700', color: useTheme().text }}>{children}</Text>;
}
export function Subtitle({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 18, fontWeight: '600', color: useTheme().text, marginTop: 8 }}>{children}</Text>;
}
export function Body({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 16, color: useTheme().text }}>{children}</Text>;
}
export function Muted({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 14, color: useTheme().muted }}>{children}</Text>;
}
export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 14, color: useTheme().danger }}>{children}</Text>;
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Muted>{label}</Muted>
      <Text style={{ fontSize: 18, fontWeight: '600', color: useTheme().text }}>{value}</Text>
    </View>
  );
}

export function Button({ title, onPress, kind = 'primary', busy, disabled }: {
  title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger' | 'link'; busy?: boolean; disabled?: boolean;
}) {
  const t = useTheme();
  const filled = kind === 'primary' || kind === 'danger';
  const background = kind === 'primary' ? t.accent : kind === 'danger' ? t.danger : 'transparent';
  const color = filled ? t.accentText : kind === 'link' ? t.muted : t.accent;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 12, backgroundColor: background,
        borderWidth: kind === 'secondary' ? 1 : 0, borderColor: t.accent, opacity: pressed || disabled ? 0.6 : 1,
      })}>
      {busy ? <ActivityIndicator color={color} /> : <Text style={{ color, fontSize: 16, fontWeight: '600' }}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...input }: TextInputProps & { label: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Muted>{label}</Muted>
      <TextInput
        placeholderTextColor={t.muted}
        style={{ borderWidth: 1, borderColor: t.border, borderRadius: 10, padding: 12, fontSize: 16, color: t.text, backgroundColor: t.card }}
        {...input}
      />
    </View>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const t = useTheme();
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: t.track, overflow: 'hidden' }}>
      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: t.accent }} />
    </View>
  );
}
