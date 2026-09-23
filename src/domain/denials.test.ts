import type { EntitlementDenial } from './entitlements';
import { denialMessage } from './denials';

/**
 * A denial must always SAY something. A silent refusal is the failure this path exists
 * to prevent and it shipped once already (the unreachable paywall). So the property under
 * test is not any particular sentence -- it is that no input, including one the copy map
 * has never met, produces an empty string.
 */
describe('denialMessage', () => {
  it('names every limit the ladder can refuse', () => {
    for (const limit of ['folders', 'photos', 'hosts', 'guests'] as const) {
      const text = denialMessage({ kind: 'limit', limit } as EntitlementDenial);
      expect(text.length).toBeGreaterThan(10);
      expect(text.endsWith('.')).toBe(true);
    }
  });

  it('still speaks for a limit the copy map has not met', () => {
    const text = denialMessage({ kind: 'limit', limit: 'widgets' } as unknown as EntitlementDenial);
    expect(text).toMatch(/widgets/);
  });

  it('still speaks for a feature the copy map has not met', () => {
    const text = denialMessage({ kind: 'feature', feature: 'teleport' } as unknown as EntitlementDenial);
    expect(text.length).toBeGreaterThan(10);
  });

  /**
   * #41. The closed-event sentence is deliberately NOT phrased as a loss: everything
   * already here is still readable and savable, and saying so is the difference between a
   * guest closing the app and a guest saving the photos before the retention clock runs.
   * Mutation-checked: rewording it to "This event has ended." alone turns this red.
   */
  it('tells a guest at a closed event what is still theirs, not only what is refused', () => {
    const text = denialMessage({ kind: 'closed' } as EntitlementDenial);
    expect(text).toMatch(/still/);
    expect(text).toMatch(/save/);
  });
});
