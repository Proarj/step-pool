import { useColorScheme } from 'react-native';

const light = {
  background: '#F6F7F9', card: '#FFFFFF', text: '#14171A', muted: '#5F6B76', border: '#E3E7EB',
  accent: '#1E9E5A', accentText: '#FFFFFF', danger: '#C93A3A', track: '#E8ECEF',
};
const dark: typeof light = {
  background: '#0F1214', card: '#1A1F23', text: '#F1F3F5', muted: '#9AA5AF', border: '#2A3137',
  accent: '#34C77B', accentText: '#0B1A12', danger: '#FF6B6B', track: '#2A3137',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
