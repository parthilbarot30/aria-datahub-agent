import { Router } from 'express';
import { ARIAAgent } from '../agent/aria.js';
import { DataHubClient } from '../datahub/client.js';

const router = Router();

function makeAgent() {
  return new ARIAAgent(new DataHubClient({
    url: process.env.DATAHUB_URL || 'http://localhost:8080',
    token: process.env.DATAHUB_TOKEN || '',
  }));
}

/**
 * POST /api/investigate — returns Server-Sent Events stream of progress + final report
 * Body: { errorMessage: string }
 *
 * The SSE stream lets the frontend show live step-by-step progress while
 * ARIA is pulling DataHub context and reasoning. Each event has:
 *   { step, status, message, data? }
 * Final event type is "complete" with the full report.
 */
router.post('/investigate', async (req, res) => {
  const { errorMessage } = req.body;
  if (!errorMessage?.trim()) {
    return res.status(400).json({ error: 'errorMessage is required' });
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (eventType, payload) => {
    res.write(`event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const emit = (progress) => {
    send('progress', progress);
  };

  try {
    const agent = makeAgent();
    const report = await agent.investigate(errorMessage, emit);
    send('complete', report);
  } catch (err) {
    send('error', { message: err.message, stack: process.env.NODE_ENV === 'development' ? err.stack : undefined });
  } finally {
    res.end();
  }
});

/**
 * POST /api/investigate/sync — same investigation but returns JSON directly (no SSE)
 * Useful for curl testing and API consumers
 */
router.post('/investigate/sync', async (req, res) => {
  const { errorMessage } = req.body;
  if (!errorMessage?.trim()) {
    return res.status(400).json({ error: 'errorMessage is required' });
  }

  try {
    const agent = makeAgent();
    const report = await agent.investigate(errorMessage);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/health — liveness check, includes DataHub connectivity status
 */
router.get('/health', async (req, res) => {
  const dh = new DataHubClient({
    url: process.env.DATAHUB_URL || 'http://localhost:8080',
    token: process.env.DATAHUB_TOKEN || '',
  });

  let datahubConnected = false;
  try {
    await dh.searchDataset('test');
    datahubConnected = true;
  } catch {}

  res.json({
    status: 'ok',
    version: '1.0.0',
    datahubUrl: process.env.DATAHUB_URL || 'http://localhost:8080',
    datahubConnected,
    anthropicConfigured: !!process.env.ANTHROPIC_API_KEY,
    demoMode: !datahubConnected,
  });
});

export default router;