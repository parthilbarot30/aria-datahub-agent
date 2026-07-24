# ARIA — Autonomous Root-cause Investigation Agent

> **DataHub Agent Hackathon 2026** — Challenge 1 (Agents That Do Real Work) + Challenge 2 (Metadata-Aware Code Generation)

ARIA is an autonomous AI agent that diagnoses broken data pipelines using DataHub as its context graph. When a dbt model fails, a DAG misses its SLA, or an ML training job crashes, ARIA reads DataHub's full metadata — lineage, schema, ownership, data contracts — reasons over it with Llama 3.3 70B via Groq, generates production-ready fix artifacts, and writes incidents and tags back to the catalog. In under 60 seconds.

---

## The Problem

When a data pipeline breaks at 2am, an on-call engineer spends 60–90 minutes doing one thing: manually tracing lineage, reading schema history, figuring out what changed upstream, calculating blast radius, and writing a fix that uses the *actual* current column names. DataHub already has all the context to automate this. ARIA is the agent that does it.

---

## Demo Video

📹 **[Watch the 3-minute demo →](https://youtube.com/your-link-here)**

## Live Demo

🌐 **[Try ARIA live →](https://your-render-url.onrender.com)**

---

## How ARIA Works

Error message input
↓
Step 1 — Parse error → identify broken asset + error type
↓
Step 2 — Pull DataHub context:
• Upstream lineage (what feeds the broken asset)
• Downstream blast radius (what breaks next)
• Schema, ownership, health status
• Data contract assertion status
↓
Step 3 — LLM reasons over metadata → root cause diagnosis
↓
Step 4 — Generate fix artifacts:
• dbt SQL patch (using REAL column names from DataHub)
• Data contract YAML (prevents regression)
• Structured postmortem (blameless, PR-ready)
↓
Step 5 — Write back to DataHub:
• raiseIncident on broken asset + downstream
• addTag: ARIA:BreakingChange on upstream source
• updateDescription with investigation summary
↓
Full investigation report in under 60 seconds


---

## DataHub Integration

ARIA uses DataHub at every step — both reads and writes:

### Reads (GraphQL)
| DataHub API | ARIA Use |
|---|---|
| `search` | Resolve asset names to URNs |
| `dataset.lineage (UPSTREAM)` | Find what feeds the broken asset |
| `dataset.lineage (DOWNSTREAM)` | Calculate blast radius |
| `dataset.schemaMetadata` | Get real column names for fix generation |
| `dataset.ownership` | Identify who to page |
| `dataset.dataContract` | Check if assertions exist |
| `dataset.health` | Current health status |

### Writes (GraphQL Mutations)
| DataHub API | ARIA Use |
|---|---|
| `raiseIncident` | Flag broken asset and downstream |
| `addTag` | Tag source with `ARIA:BreakingChange` |
| `updateDescription` | Document root cause on the asset |

---

## Generated Artifacts

Every ARIA investigation produces three artifacts:

### 1. dbt Fix
Production-ready SQL using correct column names pulled from DataHub — not hallucinated. See [`examples/incident-001/fct_revenue.sql`](examples/incident-001/fct_revenue.sql)

### 2. Data Contract
DataHub-compatible YAML with schema assertions that would have caught the incident before production. See [`examples/incident-001/data-contract.yaml`](examples/incident-001/data-contract.yaml)

### 3. Postmortem
Structured blameless incident report with timeline, root cause, blast radius, and action items. See [`examples/incident-001/postmortem.md`](examples/incident-001/postmortem.md)

---

## Sample Outputs

Three complete example investigations in [`examples/`](examples/):

| Incident | Error Type | Blast Radius |
|---|---|---|
| [001 — Column Rename](examples/incident-001/) | `COLUMN_RENAMED` | 3 downstream |
| [002 — Freshness SLA](examples/incident-002/) | `FRESHNESS_SLA_MISSED` | 5 downstream |
| [003 — ML Feature Missing](examples/incident-003/) | `COLUMN_MISSING` | 2 downstream |

---

## Setup

### Prerequisites
- Node.js 18+
- Groq API key (free at [console.groq.com](https://console.groq.com))
- DataHub running locally OR skip for demo mode

### 1. Clone and install
```bash
git clone https://github.com/yourusername/aria-datahub-agent
cd aria-datahub-agent
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env:
#   GROQ_API_KEY=gsk_your_key_here
#   DATAHUB_URL=http://localhost:8080   (optional)
#   DATAHUB_TOKEN=your_pat_here        (optional)
```

### 3. Run
```bash
npm start
# Open http://localhost:3000
```

> **Demo mode:** If DataHub isn't running, ARIA uses realistic mock data so you can see the full investigation flow with all five steps and all three artifacts generated.

---

## Tech Stack

- **DataHub** — context graph, lineage, schema, incidents API
- **Llama 3.3 70B** (via Groq) — reasoning + artifact generation
- **Node.js + Express** — backend
- **Server-Sent Events** — live investigation progress stream
- **Vanilla JS + CSS** — frontend (zero dependencies)

---

## API

### `POST /api/investigate` — Streaming SSE
```bash
curl -X POST http://localhost:3000/api/investigate \
  -H "Content-Type: application/json" \
  -d '{"errorMessage": "dbt model fct_revenue failed — column payment_method_v2 not found"}'
```

### `POST /api/investigate/sync` — JSON response
### `GET /api/health` — Server + DataHub status

---

## Project Structure

aria-agent/
├── src/
│ ├── index.js # Express server
│ ├── agent/
│ │ ├── aria.js # Main agent orchestrator
│ │ └── generators/
│ │ ├── dbt-fix.js # dbt SQL patch generator
│ │ ├── data-contract.js # DataHub contract YAML
│ │ └── postmortem.js # Blameless postmortem
│ ├── datahub/
│ │ └── client.js # DataHub GraphQL + REST
│ └── routes/
│ └── investigate.js # API routes (SSE + sync)
├── public/
│ └── index.html # Investigation UI
└── examples/
├── incident-001/ # Column rename artifacts
├── incident-002/ # Freshness SLA artifacts
└── incident-003/ # ML feature missing artifacts


---

## License

Apache 2.0 — see [LICENSE](LICENSE)