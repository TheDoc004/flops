import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  const dialogRef = useRef(null);
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

  // A native modal dialog joins the top layer, so the scanner draws above a
  // form that is itself a showModal() dialog. No z-index can do that.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    // No close() on unmount: removing the element takes it out of the top layer.
  }, []);

  const manualReady = isValidGtin(manualCode);
  const showCamera = phase === 'starting' || phase === 'scanning' || phase === 'looking_up';

  return (
    <dialog
      ref={dialogRef}
      className="barcode-scan-dialog"
      aria-labelledby="barcode-scan-title"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        maxWidth: 'none',
        maxHeight: 'none',
        margin: 0,
        border: 'none',
        borderRadius: 0,
        boxShadow: 'none',
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      // Escape: close through the same path as ✕ so the camera stops.
      onCancel={e => {
        e.preventDefault();
        onClose?.();
      }}
      // Chrome may close without a cancel event (repeated Escape); still unmount.
      onClose={() => onClose?.()}
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="card barcode-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="barcode-modal__head">
          <h3 id="barcode-scan-title" className="barcode-modal__title">Scan a barcode</h3>
          <button type="button" className="modal-close-x" aria-label="Close" onClick={() => onClose?.()}>✕</button>
        </div>

        {showCamera && (
          <>
            <p className="barcode-modal__hint">
              Hold the barcode inside the frame. It scans on its own — no button to press.
            </p>
            <div className="barcode-modal__viewfinder">
              <video ref={videoRef} muted playsInline className="barcode-modal__video" />
              {/* Aiming guide — a barcode centred on this line reads fastest. */}
              <div aria-hidden="true" className="barcode-modal__guide" />
              <div role="status" className="barcode-modal__status">
                {phase === 'starting' && 'Starting camera…'}
                {phase === 'scanning' && 'Scanning…'}
                {phase === 'looking_up' && 'Looking up product…'}
              </div>
            </div>
          </>
        )}

        {notice && (
          <div role="status" className="barcode-modal__notice">
            {notice}
          </div>
        )}

        <div className="barcode-modal__manual">
          <strong className="barcode-modal__label">Type the barcode:</strong>
          <p className="barcode-modal__hint">The 8–13 digit number printed under the bars.</p>
          <div className="barcode-modal__entry">
            <input
              value={manualCode}
              onChange={e => setManualCode(e.target.value)}
              inputMode="numeric"
              placeholder="e.g. 3017620422003"
              aria-label="Barcode number"
              className="barcode-modal__input"
              onKeyDown={e => {
                if (e.key === 'Enter' && manualReady) {
                  e.preventDefault();
                  void handleCode(manualCode);
                }
              }}
            />
            <button
              type="button"
              className="btn-primary barcode-modal__lookup"
              disabled={!manualReady || phase === 'looking_up'}
              onClick={() => void handleCode(manualCode)}
            >
              {phase === 'looking_up' ? 'Looking up…' : 'Look up'}
            </button>
          </div>
          {manualCode.trim() !== '' && !manualReady && (
            <p className="barcode-modal__invalid">
              That number isn&apos;t a valid barcode yet — check for a missing or mistyped digit.
            </p>
          )}
        </div>

        <div className="barcode-modal__actions">
          <button type="button" className="btn-secondary" onClick={() => onClose?.()}>Cancel</button>
        </div>
      </div>
    </dialog>
  );
}
