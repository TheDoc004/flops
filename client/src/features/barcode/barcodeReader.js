import { isValidGtin, digitsOnly } from './gtin';

/**
 * Reads product barcodes out of a live <video>, behind one interface with two
 * decoders underneath:
 *
 *  - the browser's native `BarcodeDetector` (Chrome, Edge, Android) — fast and
 *    free, nothing to download;
 *  - `@zxing/browser`, imported lazily ONLY when the native API is missing.
 *    iPhone Safari still has no BarcodeDetector, and that is the phone this app
 *    gets used on, so the fallback is a normal path rather than an edge case.
 *    The dynamic import keeps it out of the initial bundle either way.
 *
 * The caller owns the camera stream (see BarcodeScannerModal) — this module
 * only decodes whatever the element is already showing.
 */

// Retail product barcodes only. QR/Data Matrix are deliberately excluded: they
// would decode URLs and other junk that Open Food Facts cannot look up.
const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
const POLL_MS = 250;

export function hasNativeBarcodeDetector() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

/** True when the page can legally ask for a camera at all. */
export function cameraAvailable() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  // getUserMedia is undefined outside a secure context (https or localhost).
  return Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext !== false;
}

async function startNative(videoEl, onDetected) {
  const Detector = window.BarcodeDetector;
  let formats = NATIVE_FORMATS;
  try {
    const supported = await Detector.getSupportedFormats?.();
    if (Array.isArray(supported) && supported.length) {
      formats = NATIVE_FORMATS.filter(f => supported.includes(f));
    }
  } catch {
    /* fall back to asking for all of them */
  }
  const detector = new Detector(formats.length ? { formats } : undefined);

  let stopped = false;
  let timer = null;
  const tick = async () => {
    if (stopped) return;
    try {
      const found = await detector.detect(videoEl);
      for (const code of found || []) {
        // A misread frame is normal; the check digit filters it out silently.
        if (isValidGtin(code?.rawValue)) {
          if (!stopped) onDetected(digitsOnly(code.rawValue));
          return;
        }
      }
    } catch {
      /* transient decode failures are expected between good frames */
    }
    if (!stopped) timer = setTimeout(tick, POLL_MS);
  };
  void tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

async function startZxing(videoEl, onDetected) {
  const { BrowserMultiFormatOneDReader } = await import('@zxing/browser');
  const reader = new BrowserMultiFormatOneDReader();
  let stopped = false;
  const controls = await reader.decodeFromVideoElement(videoEl, result => {
    if (stopped || !result) return;
    const text = typeof result.getText === 'function' ? result.getText() : result.text;
    if (isValidGtin(text)) onDetected(digitsOnly(text));
  });
  return () => {
    stopped = true;
    try {
      controls?.stop();
    } catch {
      /* already torn down */
    }
  };
}

/**
 * Begin decoding. Resolves to a `stop()` function — always call it, or the
 * decode loop keeps running after the modal closes.
 *
 * @param {HTMLVideoElement} videoEl a playing video element
 * @param {(code: string) => void} onDetected fires once per valid barcode
 * @returns {Promise<() => void>}
 */
export async function startBarcodeScan(videoEl, onDetected) {
  if (!videoEl) throw new Error('No video element to scan.');
  return hasNativeBarcodeDetector()
    ? startNative(videoEl, onDetected)
    : startZxing(videoEl, onDetected);
}
