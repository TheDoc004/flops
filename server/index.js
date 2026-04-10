const express = require('express');
const cors = require('cors');
const { createDb } = require('./db');
const { createRecipesRouter } = require('./routes/recipes');
const { createLogRouter } = require('./routes/log');

const db = createDb(process.env.DB_PATH || './nutrition.db');
const app = express();

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

app.use('/api/recipes', createRecipesRouter(db));
app.use('/api/log', createLogRouter(db));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Nutrition tracker API running on http://localhost:${PORT}`);
});
