import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ToastProvider, useToast, useToastState } from './ToastProvider';

/**
 * A consumer of `show` must not re-render when a toast appears or clears. The provider used
 * to hand both halves out through one context value, so every `use*Actions` hook -- every
 * screen, sheet and queue row -- re-rendered twice per toast to read a value none of them use.
 *
 * The component is a `jest.fn`, so its call count IS its render count -- no counter is
 * reassigned during render (the React Compiler lint forbids that, rightly) and nothing
 * depends on <Profiler>, which the test renderer does not drive. Mutation-checked: handing
 * consumers `{ show, toast }` as the old provider did turns the first test red.
 */
const Consumer = jest.fn(function Consumer() {
  const { show } = useToast();
  return <Text testID="consumer" onPress={() => show('hi')}>{typeof show}</Text>;
});
function Reader() {
  const t = useToastState();
  return <Text testID="reader">{t?.text ?? 'none'}</Text>;
}

beforeEach(() => Consumer.mockClear());

describe('ToastProvider', () => {
  it('does not re-render a show() consumer when a toast appears', async () => {
    await render(<ToastProvider><Consumer /><Reader /></ToastProvider>);
    const before = Consumer.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    await act(async () => { screen.getByTestId('consumer').props.onPress(); });
    expect(screen.getByTestId('reader').props.children).toBe('hi');
    expect(Consumer.mock.calls.length).toBe(before);
  });

  it('gives the toast reader the current toast', async () => {
    await render(<ToastProvider><Consumer /><Reader /></ToastProvider>);
    expect(screen.getByTestId('reader').props.children).toBe('none');
    await act(async () => { screen.getByTestId('consumer').props.onPress(); });
    expect(screen.getByTestId('reader').props.children).toBe('hi');
  });
});
