import { useCallback, useEffect, useRef, useState } from 'react';
import { cameraAvailable, startBarcodeScan } from './barcodeReader';
import { isValidGtin } from './gtin';
import { lookupBarcode as lookupBarcodeApi } from '@shared/api/barcode';

/**
 * Point the camera at a product barcode -> the looked-up product goes back to
 * the caller for review. Mount it only while open (`{open && <Modal/>}`) so the
 * camera starts and stops with the component.
 *
 * The modal owns the lookup rather than just handing back a number, so a
 * "not in Open Food Facts" answer can be retried on the spot while you are
 * still holding the product, instead of surfacing after the modal closes.
 *
 * Typing the number is always available — it is the whole feature on a browser
 * with no camera permission, and the fastest fix when a barcode is scuffed.
 */
export default function BarcodeScannerModal({ onClose, onProduct, lookup = lookupBarcodeApi }) {
  const videoRef = useRef(null);
  // Guards against a second decode landing while the first lookup is in flight.
  const busyRef = useRef(false);
  const [phase, setPhase] = useState(() => (cameraAvailable() ? 'starting' : 'no_camera'));
  const [notice, setNotice] = useState('');
  const [manualCode, setManualCode] = useState('');

  // One place for "a code arrived, go look it up" — camera and typing share it.
  const handleCode = useCallback(
    async code => {
      if (busyRef.current) return;
      busyRef.current = true;
      setPhase('looking_up');
      setNotice('');
      try {
        const product = await lookup(code);
        onProduct?.(product);
        onClose?.();
      } catch (e) {
        setNotice(
          e?.notFound
            ? `Barcode ${code} isn't in Open Food Facts yet. Try another product, type the number, or close this and scan the label instead.`
            : e?.message || 'Lookup failed.'
        );
        setPhase(cameraAvailable() ? 'scanning' : 'no_camera');
        busyRef.current = false;
      }
    },
    [lookup, onProduct, onClose]
  );

  // The camera effect runs once on mount, so it reaches the handler through a
  // ref rather than capturing the version from that first render.
  const handleCodeRef = useRef(handleCode);
  useEffect(() => {
    handleCodeRef.current = handleCode;
  }, [handleCode]);

  useEffect(() => {
    if (!cameraAvailable()) return undefined;
    let cancelled = false;
    let stopScan = null;
    let stream = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        });
        if (cancelled) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => {});
        if (cancelled) return;
        stopScan = await startBarcodeScan(video, code => {
          void handleCodeRef.current(code);
        });
        if (!cancelled) setPhase('scanning');
      } catch (e) {
        if (cancelled) return;
        setPhase('no_camera');
        setNotice(
          e?.name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow it in your browser settings, or type the barcode number below.'
            : 'No camera available here. Type the barcode number below instead.'
        );
      }
    })();

    return () => {
      cancelled = true;
      try {
        stopScan?.();
      } catch {
        /* already stopped */
      }
      // Releases the camera light — without this it stays on after closing.
      stream?.getTracks?.().forEach(t => t.stop());
    };
  }, []);

  const manualReady = isValidGtin(manualCode);
  const showCamera = phase === 'starting' || phase === 'scanning' || phase === 'looking_up';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="barcode-scan-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className="card"
        style={{ maxWidth: 460, width: '100%', margin: 0, maxHeight: '88vh', overflowY: 'auto' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <h3 id="barcode-scan-title" style={{ margin: 0 }}>Scan a barcode</h3>
          <button type="button" className="modal-close-x" aria-label="Close" onClick={() => onClose?.()}>✕</button>
        </div>

        {showCamera && (
          <>
            <p style={{ margin: '4px 0 12px', fontSize: 13, color: 'var(--color-text-muted)' }}>
              Hold the barcode inside the frame. It scans on its own — no button to press.
            </p>
            <div
              style={{
                position: 'relative',
                background: '#000',
                borderRadius: 10,
                overflow: 'hidden',
                aspectRatio: '4 / 3',
              }}
            >
              <video
                ref={videoRef}
                muted
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              {/* Aiming guide — a barcode centred on this line reads fastest. */}
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: '10%',
                  right: '10%',
                  top: '50%',
                  height: 2,
                  background: 'rgba(239,68,68,0.9)',
                  transform: 'translateY(-1px)',
                }}
              />
              <div
                role="status"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  padding: '8px 12px',
                  fontSize: 13,
                  color: '#fff',
                  background: 'rgba(0,0,0,0.55)',
                }}
              >
                {phase === 'starting' && 'Starting camera…'}
                {phase === 'scanning' && 'Scanning…'}
                {phase === 'looking_up' && 'Looking up product…'}
              </div>
            </div>
          </>
        )}

        {notice && (
          <div
            role="status"
            style={{
              marginTop: 12,
              padding: '10px 12px',
              fontSize: 13,
              color: '#92400e',
              background: '#fffbeb',
              border: '1px solid #fcd34d',
              borderRadius: 8,
            }}
          >
            {notice}
          </div>
        )}

        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #f0ede8' }}>
          <strong style={{ display: 'block', fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
            Type the barcode:
          </strong>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--color-text-muted)' }}>
            The 8–13 digit number printed under the bars.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={manualCode}
              onChange={e => setManualCode(e.target.value)}
              inputMode="numeric"
              placeholder="e.g. 3017620422003"
              aria-label="Barcode number"
              style={{ flex: '1 1 180px', minWidth: 0 }}
              onKeyDown={e => {
                if (e.key === 'Enter' && manualReady) {
                  e.preventDefault();
                  void handleCode(manualCode);
                }
              }}
            />
            <button
              type="button"
              className="btn-primary"
              disabled={!manualReady || phase === 'looking_up'}
              onClick={() => void handleCode(manualCode)}
            >
              {phase === 'looking_up' ? 'Looking up…' : 'Look up'}
            </button>
          </div>
          {manualCode.trim() !== '' && !manualReady && (
            <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>
              That number isn&apos;t a valid barcode yet — check for a missing or mistyped digit.
            </p>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn-secondary" onClick={() => onClose?.()}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
