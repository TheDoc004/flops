/**
 * Optional OCR for nutrition label photos. Runs multiple preprocess variants and
 * picks the best Tesseract result (confidence + text length).
 */
import { preprocessLabelImageForOcr } from './labelImagePreprocess.js';

const SOFT_PARTIAL =
  "Partial read — review and complete the missing fields.";
const OCR_FAIL =
  "Couldn't read this image. Try cropping or better lighting.";

async function recognizeOne(worker, blob) {
  const { data } = await worker.recognize(blob);
  const text = (data?.text || '').trim();
  const confidence = Number(data?.confidence);
  const conf = Number.isFinite(confidence) ? confidence : text.length > 20 ? 50 : 20;
  return { text, confidence: conf };
}

function pickBestAttempts(attempts) {
  const valid = attempts.filter(a => a && a.text && a.text.length > 0);
  if (valid.length === 0) return null;
  valid.sort((a, b) => {
    const dc = b.confidence - a.confidence;
    if (Math.abs(dc) > 8) return dc;
    return b.text.length - a.text.length;
  });
  return valid[0];
}

/**
 * @param {File|Blob} imageFile
 * @returns {Promise<{
 *   ok: boolean,
 *   text: string,
 *   isEmpty: boolean,
 *   errorMessage: string | null,
 *   confidence: number,
 *   partial: boolean,
 * }>}
 */
export async function extractTextFromLabelImage(imageFile) {
  if (!imageFile) {
    return {
      ok: true,
      text: '',
      isEmpty: true,
      errorMessage: null,
      confidence: 0,
      partial: true,
    };
  }

  let worker;
  try {
    const { createWorker } = await import('tesseract.js');
    worker = await createWorker('eng', 1, { logger: () => {} });
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
    });

    const attempts = [];

    try {
      const bin = await preprocessLabelImageForOcr(imageFile, { variant: 'binary', maxSide: 1800 });
      const r1 = await recognizeOne(worker, bin);
      attempts.push({ ...r1, strategy: 'preprocessed_binary' });
    } catch {
      /* preprocess optional */
    }

    try {
      const soft = await preprocessLabelImageForOcr(imageFile, { variant: 'soft', maxSide: 1800 });
      const r2 = await recognizeOne(worker, soft);
      attempts.push({ ...r2, strategy: 'preprocessed_soft' });
    } catch {
      /* optional */
    }

    try {
      const r3 = await recognizeOne(worker, imageFile);
      attempts.push({ ...r3, strategy: 'original' });
    } catch {
      /* ignore */
    }

    const best = pickBestAttempts(attempts);

    if (!best) {
      return {
        ok: true,
        text: '',
        isEmpty: true,
        errorMessage: SOFT_PARTIAL,
        confidence: 0,
        partial: true,
      };
    }

    const lowConfidence = best.confidence < 35 && best.text.length < 80;
    return {
      ok: true,
      text: best.text,
      isEmpty: false,
      errorMessage: lowConfidence ? SOFT_PARTIAL : null,
      confidence: best.confidence,
      partial: lowConfidence,
    };
  } catch (e) {
    console.warn('[label OCR]', e);
    return {
      ok: false,
      text: '',
      isEmpty: true,
      errorMessage: OCR_FAIL,
      confidence: 0,
      partial: true,
    };
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        /* ignore */
      }
    }
  }
}
