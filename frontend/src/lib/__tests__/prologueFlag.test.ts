import { afterEach, describe, expect, it } from 'vitest';
import { isPrologueEnabled, prologueCanon, setPrologueFlag } from '../prologueFlag';

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

describe('setPrologueFlag', () => {
  it('adds and removes the param', () => {
    setPrologueFlag(true);
    expect(window.location.search).toBe('?prologue=1');
    expect(isPrologueEnabled()).toBe(true);
    setPrologueFlag(false);
    expect(window.location.search).toBe('');
    expect(isPrologueEnabled()).toBe(false);
  });

  it('keeps canon and other params, the path and the hash', () => {
    window.history.pushState({}, '', '/play?canon=scene&x=2#top');
    setPrologueFlag(true);
    expect(window.location.pathname).toBe('/play');
    expect(prologueCanon()).toBe('scene');
    expect(new URLSearchParams(window.location.search).get('x')).toBe('2');
    expect(window.location.hash).toBe('#top');
    expect(isPrologueEnabled()).toBe(true);
    setPrologueFlag(false);
    expect(window.location.search).toBe('?canon=scene&x=2');
    expect(window.location.pathname).toBe('/play');
    expect(window.location.hash).toBe('#top');
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
