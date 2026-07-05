const express = require('express');
const {
  estimateMacros,
  AiConfigError,
  AiProviderError,
  AiResponseError,
  AiQuotaError,
} = require('../aiMacroService');
const { transcribeAudio } = require('../aiTranscribe');

const MAX_DESCRIPTION = 2000;
const MAX_CORRECTION = 1000;

function createAiRouter() {
  const router = express.Router();

  // POST /api/ai/macro-estimate — natural-language meal -> structured macro estimate.
  router.post('/macro-estimate', async (req, res) => {
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    const correction = typeof req.body?.correction === 'string' ? req.body.correction.trim() : '';
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

    if (!description) {
      return res.status(400).json({ error: 'Please describe the meal you want to estimate.' });
    }
    if (description.length > MAX_DESCRIPTION) {
      return res.status(400).json({ error: `Description is too long (max ${MAX_DESCRIPTION} characters).` });
    }
    if (correction.length > MAX_CORRECTION) {
      return res.status(400).json({ error: `Correction is too long (max ${MAX_CORRECTION} characters).` });
    }

    try {
      const estimate = await estimateMacros({ description, correction, recipes });
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
