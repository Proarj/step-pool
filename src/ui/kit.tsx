import type { ReactNode } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View,
  type TextInputProps, type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatCoins } from '@/lib/format';
import { useTheme, type Theme } from './theme';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

function cardShadow(t: Theme): ViewStyle {
  // A soft lift in light mode; dark mode relies on the lighter card surface.
  return t.dark
    ? {}
    : { shadowColor: '#11142B', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 };
}

export function Screen({ children, refreshing, onRefresh }: {
  children: ReactNode; refreshing?: boolean; onRefresh?: () => void;
}) {
  const t = useTheme();
  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: t.background }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 32, gap: 14 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.accent} /> : undefined}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.card, borderRadius: 16, padding: 16, gap: 10, ...cardShadow(t) }}>
      {children}
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 28, fontWeight: '700', color: useTheme().text }}>{children}</Text>;
}
export function Subtitle({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 17, fontWeight: '700', color: useTheme().text, marginTop: 10 }}>{children}</Text>;
}
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text style={{ fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', color: useTheme().muted, marginTop: 10, marginHorizontal: 4 }}>
      {children}
    </Text>
  );
}
export function Body({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 16, color: useTheme().text }}>{children}</Text>;
}
export function Muted({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 14, lineHeight: 20, color: useTheme().muted }}>{children}</Text>;
}
export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 14, color: useTheme().loss }}>{children}</Text>;
}

/** A coin amount coloured by sign: green for won, red for lost. */
export function Coins({ value, size = 16 }: { value: number; size?: number }) {
  const t = useTheme();
  const color = value > 0 ? t.win : value < 0 ? t.loss : t.muted;
  return <Text style={{ fontSize: size, fontWeight: '700', color }}>{formatCoins(value)}</Text>;
}

export function Stat({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ fontSize: 12, color: t.muted }}>{label}</Text>
      <Text style={{ fontSize: 18, fontWeight: '700', color: t.text }}>{value}</Text>
    </View>
  );
}

/**
 * primary: the one main action on a screen. secondary: outlined.
 * link: quiet text. danger: quiet red text (e.g. "Leave group").
 */
export function Button({ title, onPress, kind = 'primary', busy, disabled }: {
  title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger' | 'link'; busy?: boolean; disabled?: boolean;
}) {
  const t = useTheme();
  const filled = kind === 'primary';
  const color = filled ? t.onAccent : kind === 'danger' ? t.loss : kind === 'link' ? t.muted : t.accent;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingHorizontal: 16, borderRadius: 14,
        backgroundColor: filled ? t.accent : kind === 'secondary' ? t.accentSoft : 'transparent',
        opacity: pressed || disabled ? 0.6 : 1,
      })}>
      {busy ? <ActivityIndicator color={color} /> : <Text style={{ color, fontSize: 16, fontWeight: '600' }}>{title}</Text>}
    </Pressable>
  );
}

/** A small rounded button, e.g. "Share" next to the invite code. */
export function Pill({ title, onPress }: { title: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: t.accentSoft, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ color: t.accent, fontSize: 14, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, ...input }: TextInputProps & { label: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: t.muted }}>{label}</Text>
      <TextInput
        placeholderTextColor={t.muted}
        style={{ borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, color: t.text, backgroundColor: t.field }}
        {...input}
      />
    </View>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const t = useTheme();
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: t.track, overflow: 'hidden' }}>
      <View style={{ width: `${pct}%`, height: '100%', borderRadius: 3, backgroundColor: value >= 1 ? t.win : t.accent }} />
    </View>
  );
}

/** A card holding tappable rows separated by hairlines (iOS-settings style). */
export function ListGroup({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <View style={{ backgroundColor: t.card, borderRadius: 16, paddingHorizontal: 16, ...cardShadow(t) }}>{children}</View>;
}

export function ListRow({ title, subtitle, value, accentValue, onPress, first }: {
  title: string; subtitle?: string; value: string; accentValue?: boolean; onPress: () => void; first?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', paddingVertical: 15, gap: 12,
        borderTopWidth: first ? 0 : 1, borderTopColor: t.separator, opacity: pressed ? 0.6 : 1,
      })}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 16, color: t.text }}>{title}</Text>
        {subtitle ? <Text style={{ fontSize: 13, color: t.muted }}>{subtitle}</Text> : null}
      </View>
      <Text style={{ fontSize: 16, fontWeight: '600', color: accentValue ? t.accent : t.text }}>{value}</Text>
      <Text style={{ fontSize: 20, color: t.muted }}>›</Text>
    </Pressable>
  );
}

/** The big, easy-to-read invite code. */
export function Code({ children }: { children: string }) {
  return <Text style={{ fontFamily: MONO, fontSize: 28, fontWeight: '700', letterSpacing: 5, color: useTheme().text }}>{children}</Text>;
}

/** A bottom sheet with one number field and a single Save. */
export function EditSheet({ visible, title, hint, label, value, onChangeText, onSave, onClose, busy, error }: {
  visible: boolean; title: string; hint: string; label: string; value: string;
  onChangeText: (text: string) => void; onSave: () => void; onClose: () => void; busy?: boolean; error?: string;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable accessibilityLabel="Close" onPress={onClose} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: t.scrim }} />
        <View style={{ backgroundColor: t.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 20 + insets.bottom, gap: 14 }}>
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: t.track }} />
          <Text style={{ fontSize: 20, fontWeight: '700', color: t.text }}>{title}</Text>
          <Muted>{hint}</Muted>
          <Field label={label} value={value} onChangeText={onChangeText} keyboardType="number-pad" autoFocus selectTextOnFocus />
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button title="Save" onPress={onSave} busy={busy} />
          <Button kind="link" title="Cancel" onPress={onClose} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
