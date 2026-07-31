import axios from "axios";

/**
 * DataHub client: wraps GraphQL (reads) and REST (mutations).
 * All methods map directly to what ARIA needs during an investigation.
 */
export class DataHubClient {
  constructor({ url, token }) {
  this.url = url.replace(/\/$/, '');
  this.gql = `${this.url}/api/graphql`;
  this.headers = {
    'Content-Type': 'application/json',
    // Basic auth for local DataHub (datahub:datahub)
    'Authorization': token 
      ? `Bearer ${token}` 
      : 'Basic ' + Buffer.from('datahub:datahub').toString('base64'),
  };
}


  async _gql(query, variables = {}) {
  const res = await axios.post(this.gql, { query, variables }, { headers: this.headers });
  if (res.data.errors) {
    console.error('GQL ERRORS:', JSON.stringify(res.data.errors));
  }
  return res.data.data;
}

  // ─── READ TOOLS ──────────────────────────────────────────────────────────────

  /** Resolve a dataset URN from a human name like "fct_revenue" */
  async searchDataset(name) {
    const data = await this._gql(
      `
      query Search($input: SearchInput!) {
        search(input: $input) {
          searchResults { entity { urn } }
        }
      }
    `,
      { input: { type: "DATASET", query: name, start: 0, count: 10 } },
    );

    const results = data.search.searchResults.map((r) => r.entity.urn);
    return results;
  }

  /** Full metadata: schema, owner, description, tags, domains, glossary */
  async getEntityMetadata(urn) {
  const data = await this._gql(`
    query GetDataset($urn: String!) {
      dataset(urn: $urn) {
        urn
        name
        platform { name }
        description
        ownership {
          owners {
            owner {
              ... on CorpUser { username }
              ... on CorpGroup { name }
            }
          }
        }
        schemaMetadata {
          fields { fieldPath type description nullable }
          version
        }
        tags { tags { tag { name } } }
        health { status }
      }
    }
  `, { urn });
  return data.dataset;
}

  /** Upstream lineage — who feeds this dataset */
  async getUpstreamLineage(urn, depth = 3) {
    const data = await this._gql(
      `
      query Lineage($urn: String!) {
        dataset(urn: $urn) {
          upstream: lineage(input: { direction: UPSTREAM, start: 0, count: 50 }) {
            relationships {
              entity {
                urn
                ... on Dataset {
                  name
                  platform { name }
                  schemaMetadata { fields { fieldPath type } version }
                }
              }
              type
            }
          }
        }
      }
    `,
      { urn },
    );
    const results = data.dataset?.upstream?.relationships ?? [];
    return results;
  }

  async getDownstreamImpact(urn, depth = 4) {
  const data = await this._gql(`
    query Downstream($urn: String!) {
      dataset(urn: $urn) {
        lineage(input: { direction: DOWNSTREAM, start: 0, count: 100 }) {
          relationships {
            entity {
              urn
              ... on Dataset { name platform { name } }
            }
            type
          }
        }
      }
    }
  `, { urn });
  const results = data.dataset?.lineage?.relationships ?? [];
  return results;
}

  /** Recent SQL queries referencing this dataset — shows how it's actually used */
  async getRecentQueries(urn) {
    const data = await this._gql(
      `
      query Queries($urn: String!) {
        dataset(urn: $urn) {
          usageStats(range: WEEK, maxRows: 10) {
            buckets { bucket queries { query } }
          }
        }
      }
    `,
      { urn },
    );
    return data.dataset?.usageStats?.buckets ?? [];
  }

  /** Data contract assertions for this asset */
  async getDataContract(urn) {
  return null; // dataContract field not available in this DataHub version
}

  /** Active incidents already on this asset */
  async getActiveIncidents(urn) {
    const data = await this._gql(
      `
      query Incidents($urn: String!) {
        dataset(urn: $urn) {
          incidents(state: ACTIVE, start: 0, count: 10) {
            incidents { urn title description incidentType }
          }
        }
      }
    `,
      { urn },
    );
    return data.dataset?.incidents?.incidents ?? [];
  }

  // ─── WRITE TOOLS ─────────────────────────────────────────────────────────────

  /** Raise an incident on a DataHub asset */
  async raiseIncident({ resourceUrn, type, title, description }) {
    const data = await this._gql(
      `
      mutation RaiseIncident($input: RaiseIncidentInput!) {
        raiseIncident(input: $input)
      }
    `,
      {
        input: {
          resourceUrn,
          type: type || "DATA_SCHEMA",
          title,
          description,
        },
      },
    );
    return data.raiseIncident; // returns the new incident URN
  }

  /** Resolve a previously raised incident */
  async resolveIncident(incidentUrn, message) {
    await this._gql(
      `
      mutation ResolveIncident($urn: String!, $input: UpdateIncidentStatusInput!) {
        updateIncidentStatus(urn: $urn, input: $input)
      }
    `,
      { urn: incidentUrn, input: { state: "RESOLVED", message } },
    );
  }

  /** Add a tag to flag a column or dataset (e.g. "ARIA:BreakingChange") */
  async addTag({ resourceUrn, tagName }) {
  try {
    // Create the tag using correct format
    await this._gql(`
      mutation {
        createTag(input: { id: "${tagName}", name: "${tagName}" })
      }
    `);
  } catch(e) {} // ignore if exists

  try {
    await this._gql(`
      mutation {
        addTag(input: { 
          tagUrn: "urn:li:tag:${tagName}", 
          resourceUrn: "${resourceUrn}"
        })
      }
    `);
  } catch(e) {}
}

  /** Update the description / documentation of a dataset */
  async updateDescription({ resourceUrn, description }) {
    await this._gql(
      `
      mutation UpdateDescription($input: StringMapEntryInput!) {
        updateDescription(input: $input)
      }
    `,
      { input: { key: resourceUrn, value: description } },
    ).catch(() => {
      // Fallback: some versions use editableSchemaMetadata
    });
  }
}
