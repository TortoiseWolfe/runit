import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as RN from 'react-native';

import { ThemeProvider, useTheme } from './ThemeProvider';
import { DARK, LIGHT } from './tokens';

// NOTE: @testing-library/react-native v14 made `render` ASYNC. Every call must
// be awaited or `screen` stays empty and every query fails with the misleading
// "`render` function has not been called".

function Probe() {
  const { scheme, tokens } = useTheme();
  return <Text>{`${scheme}:${tokens.base100}`}</Text>;
}

const mockScheme = (v: unknown) =>
  jest.spyOn(RN, 'useColorScheme').mockReturnValue(v as ReturnType<typeof RN.useColorScheme>);

const renderProbe = (initial?: 'system' | 'dark' | 'light') =>
  render(
    <ThemeProvider {...(initial ? { initial } : {})}>
      <Probe />
    </ThemeProvider>,
  );

afterEach(() => jest.restoreAllMocks());

describe('theme resolution matches the canvas', () => {
  it.each(['light', 'dark'] as const)('follows an explicit system preference: %s', async (s) => {
    mockScheme(s);
    await renderProbe();
    expect(screen.getByText(`${s}:${s === 'dark' ? DARK.base100 : LIGHT.base100}`)).toBeTruthy();
  });

  // The canvas's fallback is `mq ? mq.matches : true` -- unknown means DARK.
  // Getting this backwards is a whole-app-wrong-colour bug that no unit test of
  // an individual screen would catch.
  it.each([null, undefined, 'unspecified'])(
    'falls back to dark when the system preference is unknown (%s)',
    async (v) => {
      mockScheme(v);
      await renderProbe();
      expect(screen.getByText(`dark:${DARK.base100}`)).toBeTruthy();
    },
  );

  it('an explicit user choice overrides the system preference', async () => {
    mockScheme('dark');
    await renderProbe('light');
    expect(screen.getByText(`light:${LIGHT.base100}`)).toBeTruthy();
  });

  it('throws a useful error outside the provider', async () => {
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(render(<Probe />)).rejects.toThrow(/must be used inside <ThemeProvider>/);
    quiet.mockRestore();
  });
});
