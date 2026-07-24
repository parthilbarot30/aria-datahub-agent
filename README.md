# ARIA — Autonomous Root-cause Investigation Agent

> **DataHub Agent Hackathon 2026** — Challenge 1 (Agents That Do Real Work) + Challenge 2 (Metadata-Aware Code Generation)

ARIA is an autonomous AI agent that diagnoses broken data pipelines using DataHub as its context graph. When a dbt model fails, a DAG misses its SLA, or an ML training job crashes, ARIA reads DataHub's full metadata — lineage, schema, ownership, data contracts — reasons over it with Claude, generates production-ready fix artifacts, and writes incidents and tags back to the catalog. In under 60 seconds.

---

## The Problem

When a data pipeline breaks at 2am, an on-call engineer spends 60–90 minutes doing one thing: manually tracing lineage, reading schema history, figuring out what changed upstream, calculating blast radius, and writing a fix that uses the *actual* current column names. DataHub already has all the context to automate this. Nobody had built the agent that does.

---

## Demo Video

📹 **[Watch the 3-minute demo →](https://youtube.com/your-link-here)**

---

## How ARIA Works

```
Error message input
       ↓
Step 1 — Parse error → identify broken asset + error type
       ↓
Step 2 — Pull DataHub context via MCP:
         • get_lineage (upstream + downstream)
         • get_entities (schema, ownership, description, health)
         • list_schema_fields
         • getDataContract (assertion status)
       ↓
Step 3 — Claude reasons over metadata → root cause diagnosis
       ↓
Step 4 — Generate fix artifacts:
         • dbt SQL patch (using REAL column names from DataHub)
         • Data contract YAML (prevents regression)
         • Structured postmortem (blameless, PR-ready)
       ↓
Step 5 — Write back to DataHub:
         • raiseIncident on broken asset + high-severity downstream
         • addTag: ARIA:BreakingChange on upstream source
         • updateDescription with investigation summary
       ↓
Full investigation report
```

---

## DataHub Integration

ARIA uses DataHub at every step — both **reads** and **writes**:

### Reads (via DataHub MCP Server + GraphQL)
| DataHub Tool | ARIA Use |
|---|---|
| `get_entities` | Schema, ownership, description, health status |
| `get_lineage` | Upstream dependencies + downstream blast radius |
| `list_schema_fields` | Full column list for fix generation |
| `getDataContract` | Check if assertions exist; flag absence as prevention gap |
| `search` | Resolve human asset names to URNs |

### Writes (via DataHub GraphQL API)
| DataHub API | ARIA Use |
|---|---|
| `raiseIncident` | Flag broken asset and high-severity downstream assets |
| `addTag` | Tag breaking source with `ARIA:BreakingChange` |
| `updateDescription` | Document root cause and fix strategy on the asset |
| `propose_lifecycle_stage` | Flag deprecated columns for review |

---

## Generated Artifacts

Every ARIA investigation produces three artifacts that live in your repo:

### 1. dbt Fix (`model_name.sql`)
A production-ready SQL file with correct column names pulled directly from DataHub's schema — not hallucinated. See [`examples/incident-001/fct_revenue.sql`](examples/incident-001/fct_revenue.sql).

### 2. Data Contract (`data-contract.yaml`)
A DataHub-compatible assertion file targeting the upstream source, with schema assertions for the columns that broke, freshness SLAs, and quality checks. See [`examples/incident-001/data-contract.yaml`](examples/incident-001/data-contract.yaml).

### 3. Postmortem (`postmortem.md`)
A structured, blameless incident report ready for Confluence or Notion. Includes timeline, root cause, blast radius, action items. See [`examples/incident-001/postmortem.md`](examples/incident-001/postmortem.md).

---

## Sample Outputs

Three complete example investigations are included in [`examples/`](examples/):

| Incident | Error Type | Blast Radius | ARIA Time |
|---|---|---|---|
| [001 — Column Rename](examples/incident-001/) | `COLUMN_RENAMED` | 3 downstream | 47s |
| [002 — Freshness SLA](examples/incident-002/) | `FRESHNESS_SLA_MISSED` | 5 downstream | 38s |
| [003 — ML Feature Missing](examples/incident-003/) | `COLUMN_MISSING` | 2 downstream (ML) | 52s |

---

## Setup

### Prerequisites
- Node.js 18+
- An Anthropic API key
- DataHub running locally OR the demo.datahub.com instance

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
#   ANTHROPIC_API_KEY=your_key
#   DATAHUB_URL=http://localhost:8080
#   DATAHUB_TOKEN=your_datahub_pat
```

### 3. Start DataHub (if running locally)
```bash
pip install acryl-datahub
datahub docker quickstart
```

### 4. Run ARIA
```bash
npm start
# Open http://localhost:3000
```

> **Demo mode:** If DataHub isn't running, ARIA uses realistic mock data so you can see the full investigation flow with all five steps and all three artifacts.

---

## API

ARIA exposes two endpoints:

### `POST /api/investigate` — Streaming (SSE)
Returns a real-time event stream of investigation progress.
```bash
curl -X POST http://localhost:3000/api/investigate \
  -H "Content-Type: application/json" \
  -d '{"errorMessage": "dbt model fct_revenue failed — column payment_method_v2 not found"}'
```

### `POST /api/investigate/sync` — JSON
Returns the complete investigation report as JSON.

### `GET /api/health`
Returns server status and DataHub connectivity.

---

## Architecture

```
aria/
├── src/
│   ├── index.js              # Express server
│   ├── agent/
│   │   ├── aria.js           # Main agent orchestrator
│   │   └── generators/
│   │       ├── dbt-fix.js    # dbt SQL patch generator
│   │       ├── data-contract.js  # DataHub contract YAML
│   │       └── postmortem.js # Blameless postmortem
│   ├── datahub/
│   │   └── client.js         # DataHub GraphQL + REST client
│   └── routes/
│       └── investigate.js    # API routes (SSE + sync)
├── public/
│   └── index.html            # Live investigation UI
└── examples/
    ├── incident-001/         # Column rename: full artifacts
    ├── incident-002/         # Freshness SLA: full artifacts
    └── incident-003/         # ML feature missing: full artifacts
```

---

## License

Apache 2.0 — see [LICENSE](LICENSE)

---

## Built with

- **DataHub** — context graph, lineage, schema, incidents API
- **Claude** (`claude-sonnet-4-6`) — reasoning + artifact generation
- **Node.js + Express** — backend
- **Server-Sent Events** — live investigation progress stream