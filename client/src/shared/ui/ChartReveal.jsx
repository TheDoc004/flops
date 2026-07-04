import useInView from '@shared/hooks/useInView';

/**
 * Defers rendering a chart until it scrolls into view, so its draw-in
 * animation plays in front of the user instead of finishing off-screen.
 * Reserves the chart's height up front to avoid layout shift; wrap the
 * chart's <ResponsiveContainer> directly.
 */
export default function ChartReveal({ height, children }) {
  const [ref, inView] = useInView();
  return (
    <div ref={ref} style={{ width: '100%', height }}>
      {inView ? children : null}
    </div>
  );
}
