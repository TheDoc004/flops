const express = require('express');
const {
  estimateMacros,
  AiConfigError,
  AiProviderError,
  AiResponseError,
  AiQuotaError,
} = require('../aiMacroService');
const { transcribeAudio } = require('../aiTranscribe');
const { suggestSubstitutes } = require('../suggestSubstitutesService');

const MAX_DESCRIPTION = 2000;
const MAX_CORRECTION = 1000;
const MAX_CORRECTIONS = 15;
const MAX_ESTIMATE_INGREDIENTS = 40;
// The saved-ingredient list is one short line each, so a generous cap still
// costs little; most-used first, so a truncated library keeps its best entries.
const MAX_SAVED_INGREDIENTS = 150;

function createAiRouter() {
  const router = express.Router();

  // POST /api/ai/macro-estimate — natural-language meal -> structured macro estimate.
  router.post('/macro-estimate', async (req, res) => {
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    // Full correction history (oldest → newest). The legacy single `correction`
    // field is accepted as a one-item history.
    const corrections = (
      Array.isArray(req.body?.corrections)
        ? req.body.corrections
        : typeof req.body?.correction === 'string' ? [req.body.correction] : []
    )
      .filter(c => typeof c === 'string' && c.trim())
      .map(c => c.trim())
      .slice(-MAX_CORRECTIONS);
    // The estimate the user is currently looking at — the revision baseline.
    // Best-effort sanitize; the AI only needs names/amounts/macros.
    const rawEst = req.body?.currentEstimate;
    const currentEstimate = rawEst && typeof rawEst === 'object' && Array.isArray(rawEst.ingredients)
      ? {
          mealName: typeof rawEst.mealName === 'string' ? rawEst.mealName.slice(0, 120) : '',
          ingredients: rawEst.ingredients
            .filter(i => i && typeof i === 'object')
            .map(i => ({
              name: typeof i.name === 'string' ? i.name.slice(0, 120) : '',
              quantity: Number.isFinite(Number(i.quantity)) ? Number(i.quantity) : 0,
              unit: typeof i.unit === 'string' ? i.unit.slice(0, 30) : '',
              state: typeof i.state === 'string' ? i.state.slice(0, 20) : '',
              calories: Number(i.calories) || 0,
              protein: Number(i.protein) || 0,
              carbs: Number(i.carbs) || 0,
              fat: Number(i.fat) || 0,
              macroSource: i.macroSource === 'provided' ? 'provided' : 'estimated',
              savedIngredient: typeof i.savedIngredient === 'string' ? i.savedIngredient.slice(0, 120) : null,
            }))
            .slice(0, MAX_ESTIMATE_INGREDIENTS),
        }
      : null;
    // Saved recipes (name + ingredient names) for recipe-command matching and
    // mapping modification targets to real ingredients. Best-effort; capped.
    const recipes = Array.isArray(req.body?.recipes)
      ? req.body.recipes
          .filter(r => r && typeof r.name === 'string' && r.name.trim())
          .map(r => {
            const posInt = v => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : null);
            return {
              name: r.name.trim().slice(0, 120),
              ingredients: Array.isArray(r.ingredients)
                ? r.ingredients.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 80)).slice(0, 30)
                : [],
              // Active meal-prep metadata (limited-use templates with servings
              // left) — lets the model recognize "log my meal prep" references.
              ...(r.prep && typeof r.prep === 'object'
                ? {
                    prep: {
                      remainingServings: posInt(r.prep.remainingServings),
                      totalServings: posInt(r.prep.totalServings),
                      madeDaysAgo: posInt(r.prep.madeDaysAgo),
                    },
                  }
                : {}),
            };
          })
          .slice(0, 80)
      : [];

    // The user's saved ingredients (name + the unit each is measured in), so the
    // model can match a food to one and keep the unit they said instead of
    // normalizing "1 filet" to grams. Best-effort; capped.
    const savedIngredients = Array.isArray(req.body?.savedIngredients)
      ? req.body.savedIngredients
          .filter(i => i && typeof i.name === 'string' && i.name.trim())
          .map(i => {
            const g = Number(i.gramsPerUnit);
            return {
              name: i.name.trim().slice(0, 120),
              unit: typeof i.unit === 'string' ? i.unit.trim().slice(0, 30) : '',
              ...(Number.isFinite(g) && g > 0 ? { gramsPerUnit: g } : {}),
            };
          })
          .slice(0, MAX_SAVED_INGREDIENTS)
      : [];

    if (!description) {
      return res.status(400).json({ error: 'Please describe the meal you want to estimate.' });
    }
    if (description.length > MAX_DESCRIPTION) {
      return res.status(400).json({ error: `Description is too long (max ${MAX_DESCRIPTION} characters).` });
    }
    if (corrections.some(c => c.length > MAX_CORRECTION)) {
      return res.status(400).json({ error: `Correction is too long (max ${MAX_CORRECTION} characters).` });
    }

    try {
      const estimate = await estimateMacros({ description, corrections, currentEstimate, recipes, savedIngredients });
      return res.json(estimate);
    } catch (e) {
      if (e instanceof AiConfigError) {
        return res.status(503).json({ error: e.message });
      }
      if (e instanceof AiQuotaError) {
        return res.status(402).json({ error: e.message });
      }
      if (e instanceof AiProviderError) {
        return res.status(502).json({ error: 'The AI service had a problem. Please try again.' });
      }
      if (e instanceof AiResponseError) {
        return res.status(502).json({ error: "Couldn't read the AI estimate. Please try again or revise your description." });
      }
      return res.status(500).json({ error: 'Failed to estimate macros.' });
    }
  });

  // POST /api/ai/suggest-substitutes — pick close matches from the user's library.
  router.post('/suggest-substitutes', async (req, res) => {
    const ingredient = req.body?.ingredient && typeof req.body.ingredient === 'object'
      ? req.body.ingredient
      : null;
    if (!ingredient || !String(ingredient.name || '').trim()) {
      return res.status(400).json({ error: 'ingredient.name is required.' });
    }
    const library = Array.isArray(req.body?.library) ? req.body.library : [];
    if (library.length === 0) {
      return res.json({ suggestions: [] });
    }
    const limit = req.body?.limit;
    try {
      const result = await suggestSubstitutes({ ingredient, library, limit });
      return res.json(result);
    } catch (e) {
      if (e instanceof AiConfigError) {
        return res.status(503).json({ error: e.message });
      }
      if (e instanceof AiQuotaError) {
        return res.status(402).json({ error: e.message });
      }
      if (e instanceof AiProviderError) {
        return res.status(502).json({ error: 'The AI service had a problem. Please try again.' });
      }
      if (e instanceof AiResponseError) {
        return res.status(502).json({ error: "Couldn't read the AI substitute suggestions." });
      }
      return res.status(500).json({ error: 'Failed to suggest substitutes.' });
    }
  });

  // POST /api/ai/transcribe — voice note -> text. The client sends the raw
  // recorded blob (audio/webm on Chrome/Android, audio/mp4 on iOS) as the
  // request body; express.raw hands it over as a Buffer, no multipart needed.
  router.post('/transcribe', express.raw({ type: 'audio/*', limit: '25mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'No audio received.' });
    }
    try {
      const text = await transcribeAudio({ buffer: req.body, mimeType: req.headers['content-type'] });
      return res.json({ text });
    } catch (e) {
      if (e instanceof AiConfigError) {
        return res.status(503).json({ error: e.message });
      }
      if (e instanceof AiQuotaError) {
        return res.status(402).json({ error: e.message });
      }
      if (e instanceof AiProviderError) {
        return res.status(502).json({ error: 'The transcription service had a problem. Please try again.' });
      }
      if (e instanceof AiResponseError) {
        return res.status(502).json({ error: "Couldn't read the transcription. Please try again." });
      }
      return res.status(500).json({ error: 'Failed to transcribe audio.' });
    }
  });

  return router;
}

module.exports = { createAiRouter };
