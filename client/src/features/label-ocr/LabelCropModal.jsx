import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Simple drag-to-crop on the nutrition panel before OCR. Lightweight (no extra deps).
 */
export default function LabelCropModal({ open, imageSrc, onClose, onApply }) {
  const dialogRef = useRef(null);
  const wrapRef = useRef(null);
  const imgRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const [rect, setRect] = useState(null);

  const toLocal = useCallback(e => {
    const el = wrapRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  const onDown = e => {
    e.preventDefault();
    const p = toLocal(e);
    setDrag({ ax: p.x, ay: p.y, bx: p.x, by: p.y });
  };

  useEffect(() => {
    if (!drag) return undefined;
    const move = e => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      setDrag(d => (d ? { ...d, bx: x, by: y } : null));
    };
    const up = () => {
      setDrag(d => {
        if (!d) return null;
        const { ax, ay, bx, by } = d;
        const x1 = Math.min(ax, bx);
        const y1 = Math.min(ay, by);
        const x2 = Math.max(ax, bx);
        const y2 = Math.max(ay, by);
        if (x2 - x1 < 16 || y2 - y1 < 16) setRect(null);
        else setRect({ x1, y1, x2, y2 });
        return null;
      });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [drag]);

  const applyCrop = () => {
    const img = imgRef.current;
    if (!img || !img.complete || !rect) return;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const rw = img.clientWidth;
    const rh = img.clientHeight;
    if (!rw || !rh) return;
    const sx = nw / rw;
    const sy = nh / rh;
    const cx1 = Math.round(rect.x1 * sx);
    const cy1 = Math.round(rect.y1 * sy);
    const cx2 = Math.round(rect.x2 * sx);
    const cy2 = Math.round(rect.y2 * sy);
    const cw = Math.max(1, cx2 - cx1);
    const ch = Math.max(1, cy2 - cy1);

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, cx1, cy1, cw, ch, 0, 0, cw, ch);
    canvas.toBlob(blob => {
      if (!blob) return;
      const reader = new FileReader();
      reader.onload = () => {
        const uri = typeof reader.result === 'string' ? reader.result : null;
        if (uri) onApply?.(uri);
      };
      reader.readAsDataURL(blob);
    }, 'image/jpeg', 0.92);
  };

  if (!open || !imageSrc) return null;

  const box = drag
    ? {
        left: Math.min(drag.ax, drag.bx),
        top: Math.min(drag.ay, drag.by),
        width: Math.abs(drag.bx - drag.ax),
        height: Math.abs(drag.by - drag.ay),
      }
    : rect
      ? {
          left: rect.x1,
          top: rect.y1,
          width: rect.x2 - rect.x1,
          height: rect.y2 - rect.y1,
        }
      : null;

  return (
    // A native <dialog>, not a fixed overlay: both callers are themselves
    // showModal() dialogs, which render in the browser's TOP LAYER. Nothing
    // outside that layer can cover them at any z-index, so a plain div here
    // was drawing behind the modal that opened it. Dialogs stack in the order
    // they open, so this one lands on top.
    <dialog
      ref={el => { dialogRef.current = el; if (el && !el.open) el.showModal(); }}
      onClose={() => onClose?.()}
      aria-labelledby="label-crop-title"
      style={{ width: 'min(600px, 94vw)', maxHeight: '90vh', overflowY: 'auto' }}
      onMouseDown={e => {
        // Backdrop clicks land on the dialog element itself.
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <h3 id="label-crop-title" style={{ margin: 0 }}>
            Crop to nutrition facts (optional)
          </h3>
          <button type="button" className="modal-close-x" aria-label="Close" onClick={() => dialogRef.current?.close()}>✕</button>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-text-muted)' }}>
          Drag to crop around the Nutrition Facts panel.
        </p>
        <div
          ref={wrapRef}
          style={{
            position: 'relative',
            display: 'inline-block',
            maxWidth: '100%',
            cursor: 'crosshair',
            userSelect: 'none',
          }}
          onMouseDown={onDown}
        >
          <img
            ref={imgRef}
            src={imageSrc}
            alt="Crop"
            style={{ maxWidth: '100%', height: 'auto', display: 'block', verticalAlign: 'top' }}
            draggable={false}
          />
          {box && box.width > 4 && box.height > 4 ? (
            <div
              style={{
                position: 'absolute',
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
                border: '2px solid #2563eb',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
                pointerEvents: 'none',
              }}
            />
          ) : null}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" className="btn-secondary" onClick={() => setRect(null)}>
            Clear selection
          </button>
          <button type="button" className="btn-primary" disabled={!rect} onClick={applyCrop}>
            Use cropped image
          </button>
        </div>
      </div>
    </dialog>
  );
}
