import { describe, it, expect } from 'vitest';
import { graphReadabilityFloor } from './dashboardReadability';

describe('graphReadabilityFloor', () => {
  it('requires at least ~100px of chart drawable height', () => {
    const root = document.createElement('div');
    root.style.fontSize = '14px';
    const chart = document.createElement('div');
    chart.className = 'recharts-responsive-container';
    Object.defineProperty(chart, 'offsetHeight', { value: 120, configurable: true });
    root.appendChild(chart);
    document.body.appendChild(root);
    try {
      expect(graphReadabilityFloor(root)).toBeGreaterThanOrEqual(100 / 120);
    } finally {
      document.body.removeChild(root);
    }
  });
});
