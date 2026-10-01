import { afterEach, describe, expect, it } from 'vitest';
import { isPrologueEnabled, prologueCanon } from '../prologueFlag';

afterEach(() => {
  window.history.pushState({}, '', '/');
});

describe('isPrologueEnabled', () => {
  it('is true only for ?prologue=1', () => {
    expect(isPrologueEnabled('?prologue=1')).toBe(true);
  });

  it.each(['', '?prologue=0', '?prologue=true', '?prologue=', '?other=1'])(
    'is false for %j',
    (search) => {
      expect(isPrologueEnabled(search)).toBe(false);
    },
  );

  it('reads window.location.search when no argument is given', () => {
    expect(isPrologueEnabled()).toBe(false);
    window.history.pushState({}, '', '/?prologue=1');
    expect(isPrologueEnabled()).toBe(true);
  });
});

describe('prologueCanon', () => {
  it('is scene only for ?canon=scene', () => {
    expect(prologueCanon('?canon=scene')).toBe('scene');
  });

  it.each(['', '?canon=traits', '?canon=x'])('is traits for %j', (search) => {
    expect(prologueCanon(search)).toBe('traits');
  });

  it('reads window.location.search when no argument is given', () => {
    expect(prologueCanon()).toBe('traits');
    window.history.pushState({}, '', '/?canon=scene');
    expect(prologueCanon()).toBe('scene');
  });
});
