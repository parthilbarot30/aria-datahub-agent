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

export async function generatePostmortem(diagnosis, context, assetInfo) {
  const downstream = context.downstream.map(d => d.entity.name || d.entity.urn).join(', ');

  const prompt = `Write a blameless postmortem for this data incident.

INCIDENT:
- Asset: ${assetInfo.assetName}
- Root cause: ${diagnosis.rootCauseSummary}
- Detail: ${diagnosis.rootCauseDetail}
- Breaking change type: ${diagnosis.breakingChangeType}
- Breaking source: ${diagnosis.breakingChangeSource}
- Downstream impacted (${context.downstreamCount}): ${downstream}
- Severity: ${diagnosis.blastRadiusSeverity}
- Prevention gap: ${diagnosis.preventionGap}
- Fix strategy: ${diagnosis.fixStrategy}
- Estimated fix time: ${diagnosis.estimatedFixTime}

Write a professional, blameless postmortem in Markdown format. Include:
1. Summary (2-3 sentences)
2. Timeline (fabricate realistic times, starting from ~3 hours before detection)
3. Root Cause Analysis
4. Impact
5. What Went Well
6. What Could Have Gone Better
7. Action Items (specific, with owners and deadlines)

Keep it concise but complete. Use real data engineering terminology.`;

  const res = await claude.messages.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  });

  return res.content[0].text;
}