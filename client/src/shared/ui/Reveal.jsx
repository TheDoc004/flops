import useInView from '@shared/hooks/useInView';

/**
 * Scroll-reveal wrapper: fades/slides content up the first time it enters the
 * viewport (see `.reveal` in index.css). Renders a plain div and passes through
 * className/style, so existing section containers can be converted to <Reveal>
 * without changing layout or spacing.
 *
 * @param {number} [delay] - ms before the animation starts; use small increments
 *   (60–80ms) to stagger sibling elements
 */
export default function Reveal({ delay = 0, className, style, children, ...rest }) {
  const [ref, inView] = useInView();
  const cls = ['reveal', inView && 'is-visible', className].filter(Boolean).join(' ');
  const mergedStyle = delay ? { ...style, '--reveal-delay': `${delay}ms` } : style;

  return (
    <div ref={ref} className={cls} style={mergedStyle} {...rest}>
      {children}
    </div>
  );
}
