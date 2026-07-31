import Groq from 'groq-sdk';
import { generateDbtFix } from './generators/dbt-fix.js';
import { generateDataContract } from './generators/data-contract.js';
import { generatePostmortem } from './generators/postmortem.js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Adapter so the rest of the code works unchanged
const claude = {
  messages: {
    create: async ({ model, max_tokens, system, messages }) => {
      const msgs = system
        ? [{ role: 'system', content: system }, ...messages]
        : messages;
      const res = await groq.chat.completions.create({
        model: model || 'llama-3.3-70b-versatile',
        max_tokens,
        messages: msgs,
      });
      return {
        content: [{ text: res.choices[0].message.content }]
      };
    }
  }
};
/**
 * ARIA — Autonomous Root-cause Investigation Agent
 *
 * Flow:
 *  1. Parse the error message to identify the broken asset + error type
 *  2. Pull full context from DataHub (lineage, schema, ownership, contracts)
 *  3. Ask Claude to reason over the context and diagnose root cause
 *  4. Generate fix artifacts (dbt patch, data contract, postmortem)
 *  5. Write incidents + tags back to DataHub
 *  6. Return the full investigation report
 */
export class ARIAAgent {
  constructor(datahubClient) {
    this.dh = datahubClient;
  }

  async investigate(errorMessage, emitProgress) {
  const emit = emitProgress || (() => {});
  const startTime = Date.now();

    // ── STEP 1: Identify broken asset ─────────────────────────────────────────
    emit({ step: 1, status: 'running', message: 'Parsing error to identify broken asset...' });

    const assetInfo = await this._identifyAsset(errorMessage);
    emit({ step: 1, status: 'done', message: `Identified broken asset: ${assetInfo.assetName}`, data: assetInfo });

    // ── STEP 2: Pull DataHub context ───────────────────────────────────────────
    emit({ step: 2, status: 'running', message: 'Pulling context from DataHub...' });

    const context = await this._gatherContext(assetInfo);
    emit({ step: 2, status: 'done', message: `Gathered context: ${context.upstreamCount} upstream, ${context.downstreamCount} downstream assets`, data: { summary: context.summary } });

    // ── STEP 3: Diagnose root cause ────────────────────────────────────────────
    emit({ step: 3, status: 'running', message: 'Diagnosing root cause...' });

    const diagnosis = await this._diagnose(errorMessage, context);
    emit({ step: 3, status: 'done', message: `Root cause identified: ${diagnosis.rootCauseSummary}`, data: diagnosis });

    // ── STEP 4: Generate fix artifacts ─────────────────────────────────────────
    emit({ step: 4, status: 'running', message: 'Generating fix artifacts...' });

    const artifacts = await this._generateArtifacts(diagnosis, context, assetInfo);
    emit({ step: 4, status: 'done', message: `Generated ${Object.keys(artifacts).length} fix artifacts`, data: { artifactNames: Object.keys(artifacts) } });

    // ── STEP 5: Write back to DataHub ──────────────────────────────────────────
    emit({ step: 5, status: 'running', message: 'Writing incidents and tags to DataHub...' });

    const writebackResults = await this._writeBack(assetInfo, context, diagnosis);
    emit({ step: 5, status: 'done', message: `Created ${writebackResults.incidents.length} incident(s) in DataHub`, data: writebackResults });

    // ── STEP 6: Compile report ─────────────────────────────────────────────────
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const report = {
      id: `aria-${Date.now()}`,
      timestamp: new Date().toISOString(),
      elapsed: `${elapsed}s`,
      errorMessage,
      assetInfo,
      diagnosis,
      blastRadius: {
  upstream: context.upstream.map(u => ({
    urn: u.entity.urn,
    name: u.entity.name,
    fields: u.entity?.schemaMetadata?.fields || []
  })),
  downstream: context.downstream.map(d => ({
    urn: d.entity.urn,
    name: d.entity.name
  })),
  downstreamCount: context.downstreamCount,
},
      artifacts,
      writebackResults,
      postmortem: artifacts.postmortem,
    };

    emit({ step: 6, status: 'done', message: `Investigation complete in ${elapsed}s`, data: report });

    return report;
  }

  // ─── PRIVATE METHODS ─────────────────────────────────────────────────────────

  async _identifyAsset(errorMessage) {
    const res = await claude.messages.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 500,
      system: `You are a data engineering expert. Extract the broken asset name and error type from pipeline error messages.
Respond ONLY with a JSON object. No markdown, no preamble. Fields:
- assetName: string (the dataset/model name, e.g. "fct_revenue")  
- platform: string (e.g. "dbt", "snowflake", "bigquery", "airflow" — infer from context)
- errorType: one of ["COLUMN_MISSING", "SCHEMA_MISMATCH", "FRESHNESS", "VOLUME", "PIPELINE_FAILURE", "UNKNOWN"]
- missingColumn: string or null (the specific column name if mentioned)
- errorSummary: string (one sentence) CRITICAL: Return ONLY the raw JSON object. Start with { and end with }.`,
      messages: [{ role: 'user', content: `Error message:\n${errorMessage}` }],
    });

    try {
      return JSON.parse(res.content[0].text);
    } catch {
      return {
        assetName: errorMessage.match(/`([^`]+)`/)?.[1] || 'unknown_asset',
        platform: 'unknown',
        errorType: 'UNKNOWN',
        missingColumn: null,
        errorSummary: errorMessage.slice(0, 120),
      };
    }
  }

  async _gatherContext(assetInfo) {
    let urns = [];
    try {
      urns = await this.dh.searchDataset(assetInfo.assetName);
    } catch (e) {
      return this._mockContext(assetInfo);
    }

    if (urns.length === 0) return this._mockContext(assetInfo);

    const primaryUrn = urns[0];
    const [metadata, upstream, downstream, contract, activeIncidents] = await Promise.all([
      this.dh.getEntityMetadata(primaryUrn).catch(() => null),
      this.dh.getUpstreamLineage(primaryUrn).catch(() => []),
      this.dh.getDownstreamImpact(primaryUrn).catch(() => []),
      this.dh.getDataContract(primaryUrn).catch(() => null),
      this.dh.getActiveIncidents(primaryUrn).catch(() => []),
    ]);

    return {
      primaryUrn,
      metadata,
      upstream,
      downstream,
      contract,
      activeIncidents,
      upstreamCount: upstream.length,
      downstreamCount: downstream.length,
      summary: this._buildContextSummary(metadata, upstream, downstream, contract),
    };
  }

  _buildContextSummary(metadata, upstream, downstream, contract) {
    const owners = metadata?.ownership?.owners?.map(o => o.owner?.username || o.owner?.name).join(', ') || 'unknown';
    const schema = metadata?.schemaMetadata?.fields?.map(f => `${f.fieldPath} (${f.type})`).join(', ') || 'schema unavailable';
    const upstreamNames = upstream.slice(0, 5).map(u => u.entity.name || u.entity.urn).join(', ');
    const downstreamNames = downstream.slice(0, 5).map(d => d.entity.name || d.entity.urn).join(', ');
    const contractStatus = contract ? `Contract exists with ${contract.properties?.schemaAssertions?.length || 0} schema assertions` : 'No data contract defined';

    return `
Asset: ${metadata?.name || 'unknown'}
Platform: ${metadata?.platform?.name || 'unknown'}
Owners: ${owners}
Schema (${metadata?.schemaMetadata?.fields?.length || 0} fields): ${schema.slice(0, 300)}
Schema version: ${metadata?.schemaMetadata?.version || 'unknown'}
Upstream dependencies (${upstream.length}): ${upstreamNames || 'none'}
Downstream consumers (${downstream.length}): ${downstreamNames || 'none'}
Data Contract: ${contractStatus}
Health status: ${metadata?.health?.status || 'unknown'}
    `.trim();
  }

  async _diagnose(errorMessage, context) {
    const prompt = `You are a senior data engineer performing incident root-cause analysis.

ERROR MESSAGE:
${errorMessage}

DATAHUB CONTEXT:
${context.summary}

UPSTREAM LINEAGE (${context.upstreamCount} sources):
${context.upstream.slice(0, 10).map(u => {
  const fields = u.entity?.schemaMetadata?.fields?.map(f => f.fieldPath).join(', ');
  return `- ${u.entity?.name || u.entity?.urn}: [${fields || 'fields unavailable'}]`;
}).join('\n') || 'No upstream data available'}

EXISTING INCIDENTS: ${context.activeIncidents?.length || 0} active

Analyze and respond ONLY with a JSON object. Fields:
- rootCauseSummary: string (one clear sentence)
- rootCauseDetail: string (paragraph explaining the full chain of events)
- breakingChangeSource: string (which upstream asset caused this, or "unknown")
- breakingChangeType: one of ["COLUMN_RENAMED", "COLUMN_DROPPED", "TYPE_CHANGED", "TABLE_DROPPED", "FRESHNESS_SLA_MISSED", "VOLUME_ANOMALY", "SCHEMA_EVOLUTION", "UNKNOWN"]
- affectedColumns: array of strings
- blastRadiusSeverity: one of ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
- blastRadiusExplanation: string
- preventionGap: string (what monitoring/contract was missing that would have caught this)
- fixStrategy: string (high-level approach to fix)
- estimatedFixTime: string (e.g. "~30 minutes", "~2 hours")
- ownerToPage: string (who should be paged)

CRITICAL: Return ONLY the raw JSON object. No markdown, no backticks, no \`\`\`json, no explanation. Start your response with { and end with }.`;

    const res = await claude.messages.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });

    try {
        const clean = res.content[0].text
          .replace(/```json|```/g, '')
          .trim();
        return JSON.parse(clean);
      } catch {
      return {
        rootCauseSummary: 'Could not parse diagnosis — see raw response',
        rootCauseDetail: res.content[0].text,
        breakingChangeSource: 'unknown',
        breakingChangeType: 'UNKNOWN',
        affectedColumns: [],
        blastRadiusSeverity: 'MEDIUM',
        blastRadiusExplanation: `${context.downstreamCount} downstream assets affected`,
        preventionGap: 'No data contract on the breaking column',
        fixStrategy: 'Investigate upstream schema changes',
        estimatedFixTime: '~1 hour',
        ownerToPage: 'unknown',
      };
    }
  }

  async _generateArtifacts(diagnosis, context, assetInfo) {
    const [dbtFix, dataContract, postmortem] = await Promise.all([
      generateDbtFix(diagnosis, context, assetInfo),
      generateDataContract(diagnosis, context, assetInfo),
      generatePostmortem(diagnosis, context, assetInfo),
    ]);

    return { dbtFix, dataContract, postmortem };
  }

  async _writeBack(assetInfo, context, diagnosis) {
    const results = { incidents: [], tags: [], errors: [] };
    if (!context.primaryUrn) return results;

    // Raise incident on the broken asset
    try {
      const incidentUrn = await this.dh.raiseIncident({
        resourceUrn: context.primaryUrn,
        type: 'DATA_SCHEMA',
        title: `[ARIA] ${diagnosis.rootCauseSummary}`,
        description: `${diagnosis.rootCauseDetail}\n\nBlast radius: ${context.downstreamCount} downstream assets.\n\nFix strategy: ${diagnosis.fixStrategy}\n\nAuto-diagnosed by ARIA at ${new Date().toISOString()}`,
      });
      results.incidents.push({ urn: incidentUrn, asset: assetInfo.assetName });
    } catch (e) {
      results.errors.push(`Failed to raise incident: ${e.message}`);
    }

    // Tag the breaking source column
    if (diagnosis.breakingChangeSource && diagnosis.breakingChangeSource !== 'unknown') {
      try {
        await this.dh.addTag({
  resourceUrn: context.primaryUrn,
  tagName: 'ARIA-BreakingChange',  // changed : to -
});
        results.tags.push('ARIA-BreakingChange');
      } catch (e) {
        results.errors.push(`Failed to add tag: ${e.message}`);
      }
    }

    // Raise incidents on high-severity downstream assets
    if (diagnosis.blastRadiusSeverity === 'CRITICAL' || diagnosis.blastRadiusSeverity === 'HIGH') {
      for (const downstream of context.downstream.slice(0, 3)) {
        if (!downstream.entity?.urn) continue;
        try {
          const urn = await this.dh.raiseIncident({
            resourceUrn: downstream.entity.urn,
            type: 'DATA_SCHEMA',
            title: `[ARIA] Downstream impact from ${assetInfo.assetName}`,
            description: `This asset is downstream of ${assetInfo.assetName}, which has an active incident. Data may be stale or incorrect.`,
          });
          results.incidents.push({ urn, asset: downstream.entity.name || downstream.entity.urn });
        } catch (e) {
          results.errors.push(`Downstream incident failed for ${downstream.entity.urn}: ${e.message}`);
        }
      }
    }

    return results;
  }

  // ─── MOCK CONTEXT (when DataHub not running) ─────────────────────────────────

  _mockContext(assetInfo) {
    const mockFields = ['order_id', 'customer_id', 'payment_method', 'amount', 'created_at', 'status'];
    if (assetInfo.missingColumn) mockFields.push(`${assetInfo.missingColumn}_old`);

    return {
      primaryUrn: `urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.prod.${assetInfo.assetName},PROD)`,
      metadata: {
        name: assetInfo.assetName,
        platform: { name: 'snowflake' },
        description: `Production model: ${assetInfo.assetName}`,
        ownership: { owners: [{ owner: { username: 'data-eng-team' } }] },
        schemaMetadata: {
          version: '12',
          fields: mockFields.map(f => ({ fieldPath: f, type: 'STRING', description: '', nullable: false })),
        },
        health: { status: 'ERROR' },
      },
      upstream: [
        { entity: { urn: 'urn:li:dataset:(urn:li:dataPlatform:snowflake,raw.payments,PROD)', name: 'raw.payments', platform: { name: 'snowflake' }, schemaMetadata: { version: '8', fields: [{ fieldPath: 'payment_method_v2', type: 'STRING' }, { fieldPath: 'amount', type: 'DOUBLE' }] } }, type: 'TRANSFORMED' },
        { entity: { urn: 'urn:li:dataset:(urn:li:dataPlatform:snowflake,raw.orders,PROD)', name: 'raw.orders', platform: { name: 'snowflake' }, schemaMetadata: { version: '5', fields: [{ fieldPath: 'order_id', type: 'STRING' }, { fieldPath: 'customer_id', type: 'STRING' }] } }, type: 'TRANSFORMED' },
      ],
      downstream: [
        { entity: { urn: 'urn:li:dashboard:(looker,revenue_dashboard)', name: 'Revenue Dashboard' } },
        { entity: { urn: 'urn:li:dataset:(urn:li:dataPlatform:dbt,monthly_revenue_rollup,PROD)', name: 'monthly_revenue_rollup' } },
        { entity: { urn: 'urn:li:dataset:(urn:li:dataPlatform:dbt,ml_training_features,PROD)', name: 'ml_training_features' } },
      ],
      contract: null,
      activeIncidents: [],
      upstreamCount: 2,
      downstreamCount: 3,
      summary: `Asset: ${assetInfo.assetName}\nPlatform: snowflake\nOwners: data-eng-team\nSchema (${mockFields.length} fields): ${mockFields.join(', ')}\nSchema version: 12\nUpstream dependencies (2): raw.payments, raw.orders\nDownstream consumers (3): Revenue Dashboard, monthly_revenue_rollup, ml_training_features\nData Contract: No data contract defined\nHealth status: ERROR\nNOTE: raw.payments was recently updated — schema version changed from 7 to 8. Column 'payment_method' was renamed to 'payment_method_v2'.`,
    };
  }
}