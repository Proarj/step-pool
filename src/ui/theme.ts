import { useColorScheme } from 'react-native';

// "Indigo" (picked 2026-10-11). Green/red are reserved for coins won/lost so
// they never look like buttons; indigo is the accent for actions.
const light = {
  dark: false,
  background: '#F4F5FB',
  card: '#FFFFFF',
  text: '#11142B',
  muted: '#6B7090',
  separator: '#EEF0F6',
  field: '#F0F1F8',
  accent: '#5B5BD6',
  accentSoft: '#EEF0FF',
  onAccent: '#FFFFFF',
  win: '#15803D',
  winSoft: '#E7F7EE',
  loss: '#C2353B',
  lossSoft: '#FDECEC',
  track: '#E6E8F2',
  scrim: 'rgba(17, 20, 43, 0.35)',
};
const dark: typeof light = {
  dark: true,
  background: '#0E1020',
  card: '#181B33',
  text: '#E8E9F5',
  muted: '#9A9EC0',
  separator: '#24284A',
  field: '#22264A',
  accent: '#A5A8FF',
  accentSoft: '#272B55',
  onAccent: '#0E1020',
  win: '#4ADE80',
  winSoft: '#123524',
  loss: '#FF7B80',
  lossSoft: '#3A1518',
  track: '#2A2E52',
  scrim: 'rgba(0, 0, 0, 0.55)',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
