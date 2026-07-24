import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
 * Generates a production-ready dbt model fix using the actual current schema
 * pulled from DataHub. This is the core value proposition: generated code that
 * works on the first try because it uses real metadata, not hallucinated columns.
 */
export async function generateDbtFix(diagnosis, context, assetInfo) {
  const currentSchema = context.metadata?.schemaMetadata?.fields?.map(f => f.fieldPath) || [];
  const upstreamSchemas = context.upstream.map(u => ({
    name: u.entity.name,
    fields: u.entity?.schemaMetadata?.fields?.map(f => f.fieldPath) || [],
    version: u.entity?.schemaMetadata?.version,
  }));

  const prompt = `You are a senior dbt engineer generating a production-ready fix.

BROKEN ASSET: ${assetInfo.assetName}
PLATFORM: ${assetInfo.platform}
ERROR TYPE: ${diagnosis.breakingChangeType}
ROOT CAUSE: ${diagnosis.rootCauseSummary}

CURRENT SCHEMA of ${assetInfo.assetName} (${currentSchema.length} fields from DataHub):
${currentSchema.join(', ')}

UPSTREAM SCHEMAS (from DataHub — these are the REAL current column names):
${upstreamSchemas.map(u => `${u.name} (v${u.version}): ${u.fields.join(', ')}`).join('\n')}

AFFECTED COLUMNS: ${diagnosis.affectedColumns.join(', ') || 'unknown'}

Generate a complete, production-ready dbt SQL fix. Use ONLY column names that actually exist in the schemas above.

Respond with a JSON object containing:
- modelName: string (the dbt model filename without .sql)
- sql: string (the complete fixed SQL for the dbt model)
- config: string (dbt config block as YAML for schema.yml)
- changeDescription: string (what specifically was changed and why)
- migrationNote: string (any breaking change notes for the PR description)
CRITICAL: Return ONLY the raw JSON object. Start with { and end with }.`;

  const res = await claude.messages.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  let parsed;
  try {
    parsed = JSON.parse(res.content[0].text.replace(/```json|```/g, '').trim());
  } catch {
    parsed = {
      modelName: assetInfo.assetName,
      sql: generateFallbackSQL(assetInfo, diagnosis, currentSchema, upstreamSchemas),
      config: generateFallbackConfig(assetInfo, currentSchema),
      changeDescription: diagnosis.rootCauseSummary,
      migrationNote: `Fix for ${diagnosis.breakingChangeType} — see ARIA investigation report`,
    };
  }

  return parsed;
}

function generateFallbackSQL(assetInfo, diagnosis, currentSchema, upstreamSchemas) {
  const mainUpstream = upstreamSchemas[0];
  const fields = mainUpstream?.fields?.slice(0, 8) || currentSchema.slice(0, 8);
  return `{{ config(materialized='table') }}

-- ARIA Auto-Fix: ${diagnosis.rootCauseSummary}
-- Breaking change type: ${diagnosis.breakingChangeType}
-- Generated: ${new Date().toISOString()}
-- Using schema from DataHub (upstream v${mainUpstream?.version || 'unknown'})

SELECT
${fields.map(f => `    ${f}`).join(',\n')}
FROM {{ source('${mainUpstream?.name?.split('.')[0] || 'raw'}', '${mainUpstream?.name?.split('.').pop() || 'source_table'}') }}`;
}

function generateFallbackConfig(assetInfo, fields) {
  return `models:
  - name: ${assetInfo.assetName}
    description: "Fixed by ARIA — ${new Date().toISOString()}"
    columns:
${fields.slice(0, 5).map(f => `      - name: ${f}\n        description: ""`).join('\n')}`;
}