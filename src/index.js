import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import investigateRouter from './routes/investigate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

// API routes
app.use('/api', investigateRouter);

// Serve the frontend for any non-API route
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`
  ┌─────────────────────────────────────────────────┐
  │  ARIA — Autonomous Root-cause Investigation     │
  │  Agent    v1.0.0                                │
  ├─────────────────────────────────────────────────┤
  │  UI:        http://localhost:${PORT}                │
  │  API:       http://localhost:${PORT}/api/health     │
  │  DataHub:   ${process.env.DATAHUB_URL || 'http://localhost:8080 (demo mode)'}  │
  └─────────────────────────────────────────────────┘
  `);

  if (!process.env.GROQ_API_KEY) {
    console.warn('  ⚠  GROQ_API_KEY not set — set it in .env');
  }
  if (!process.env.DATAHUB_TOKEN) {
  console.warn('  ℹ  DATAHUB_TOKEN not set — connecting without auth');
}
});