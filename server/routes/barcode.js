const express = require('express');
const { uid } = require('../userId');
const {
  lookupBarcode,
  normalizeBarcode,
  BarcodeLookupError,
  BarcodeNotFoundError,
} = require('../openFoodFactsService');

/**
 * Barcode lookup. Kept as its own route group (not folded into
 * /api/label-ingredients) because it talks to an outside service rather than
 * the database — the one DB touch here is checking whether this exact product
 * is already saved, so a re-scan reopens it instead of adding a near-duplicate.
 */
function createBarcodeRouter(db, { fetchImpl } = {}) {
  const router = express.Router();

  router.get('/:code', async (req, res) => {
    const userId = uid(req);
    const code = normalizeBarcode(req.params.code);
    if (!code) return res.status(400).json({ error: 'That barcode does not look valid.' });

    // Already in the library? Answer without spending an outside request.
    const existing = db
      .prepare(
        `SELECT id, name, brand_name, serving_size_text
           FROM label_ingredients
          WHERE user_id = ? AND barcode = ?
          LIMIT 1`
      )
      .get(userId, code);

    try {
      const product = await lookupBarcode(code, fetchImpl ? { fetchImpl } : undefined);
      return res.json({ ...product, existing_ingredient: existing || null });
    } catch (e) {
      if (e instanceof BarcodeNotFoundError) {
        // A saved ingredient still makes this a useful answer even when OFF
        // has never heard of the product.
        if (existing) {
          return res.json({
            found: false,
            barcode: code,
            error: e.message,
            existing_ingredient: existing,
          });
        }
        return res.status(404).json({ error: e.message, barcode: code });
      }
      if (e instanceof BarcodeLookupError) return res.status(502).json({ error: e.message });
      return res.status(500).json({ error: 'Barcode lookup failed.' });
    }
  });

  return router;
}

module.exports = { createBarcodeRouter };
