import { renderHook, act } from '@testing-library/react';
import { useTargets } from './useTargets';

beforeEach(() => localStorage.clear());

describe('useTargets', () => {
  it('returns null targets when localStorage is empty', () => {
    const { result } = renderHook(() => useTargets());
    expect(result.current.targets).toEqual({ calories: null, protein_g: null, carbs_g: null, fat_g: null });
  });

  it('setTarget updates a single macro target', () => {
    const { result } = renderHook(() => useTargets());
    act(() => result.current.setTarget('calories', 2000));
    expect(result.current.targets.calories).toBe(2000);
  });

  it('persists targets to localStorage', () => {
    const { result } = renderHook(() => useTargets());
    act(() => result.current.setTarget('protein_g', 150));
    expect(JSON.parse(localStorage.getItem('nutriTargets')).protein_g).toBe(150);
  });

  it('loads persisted targets on mount', () => {
    localStorage.setItem('nutriTargets', JSON.stringify({ calories: 1800, protein_g: 120, carbs_g: null, fat_g: null }));
    const { result } = renderHook(() => useTargets());
    expect(result.current.targets.calories).toBe(1800);
    expect(result.current.targets.protein_g).toBe(120);
  });
});
