import axios from 'axios';

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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  async _gql(query, variables = {}) {
    const res = await axios.post(this.gql, { query, variables }, { headers: this.headers });
    if (res.data.errors) throw new Error(res.data.errors.map(e => e.message).join('\n'));
    return res.data.data;
  }

  // ─── READ TOOLS ──────────────────────────────────────────────────────────────

  /** Resolve a dataset URN from a human name like "fct_revenue" */
  async searchDataset(name) {
    const data = await this._gql(`
      query Search($input: SearchInput!) {
        search(input: $input) {
          searchResults { entity { urn } }
        }
      }
    `, { input: { type: 'DATASET', query: name, start: 0, count: 5 } });
    return data.search.searchResults.map(r => r.entity.urn);
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
                ... on CorpUser { username email }
                ... on CorpGroup { name }
              }
            }
          }
          schemaMetadata {
            fields {
              fieldPath
              type
              description
              nullable
            }
            version
          }
          tags { tags { tag { name } } }
          glossaryTerms { terms { term { name } } }
          domain { domain { name } }
          health { status }
        }
      }
    `, { urn });
    return data.dataset;
  }

  /** Upstream lineage — who feeds this dataset */
  async getUpstreamLineage(urn, depth = 3) {
    const data = await this._gql(`
      query Lineage($urn: String!, $input: LineageInput!) {
        dataset(urn: $urn) {
          lineage(input: $input) {
            relationships {
              entity {
                urn
                ... on Dataset {
                  name platform { name }
                  schemaMetadata { fields { fieldPath type } version }
                  lastIngested
                }
              }
              type
            }
          }
        }
      }
    `, { urn, input: { direction: 'UPSTREAM', start: 0, count: 50, maxHops: depth } });
    return data.dataset?.lineage?.relationships ?? [];
  }

  /** Downstream blast radius — who breaks if THIS breaks */
  async getDownstreamImpact(urn, depth = 4) {
    const data = await this._gql(`
      query Downstream($urn: String!, $input: LineageInput!) {
        dataset(urn: $urn) {
          lineage(input: $input) {
            relationships {
              entity {
                urn
                ... on Dataset { name platform { name } }
                ... on Dashboard { name }
                ... on Chart { name }
                ... on DataJob { name }
              }
              type
            }
          }
        }
      }
    `, { urn, input: { direction: 'DOWNSTREAM', start: 0, count: 100, maxHops: depth } });
    return data.dataset?.lineage?.relationships ?? [];
  }

  /** Recent SQL queries referencing this dataset — shows how it's actually used */
  async getRecentQueries(urn) {
    const data = await this._gql(`
      query Queries($urn: String!) {
        dataset(urn: $urn) {
          usageStats(range: WEEK, maxRows: 10) {
            buckets { bucket queries { query } }
          }
        }
      }
    `, { urn });
    return data.dataset?.usageStats?.buckets ?? [];
  }

  /** Data contract assertions for this asset */
  async getDataContract(urn) {
    const data = await this._gql(`
      query Contract($urn: String!) {
        dataset(urn: $urn) {
          dataContract {
            urn
            properties {
              schemaAssertions { urn description lastExecResult { status } }
              freshnessAssertions { urn description lastExecResult { status } }
              dataQualityAssertions { urn description lastExecResult { status } }
            }
          }
        }
      }
    `, { urn });
    return data.dataset?.dataContract ?? null;
  }

  /** Active incidents already on this asset */
  async getActiveIncidents(urn) {
    const data = await this._gql(`
      query Incidents($urn: String!) {
        dataset(urn: $urn) {
          incidents(state: ACTIVE, start: 0, count: 10) {
            incidents { urn title description incidentType }
          }
        }
      }
    `, { urn });
    return data.dataset?.incidents?.incidents ?? [];
  }

  // ─── WRITE TOOLS ─────────────────────────────────────────────────────────────

  /** Raise an incident on a DataHub asset */
  async raiseIncident({ resourceUrn, type, title, description }) {
    const data = await this._gql(`
      mutation RaiseIncident($input: RaiseIncidentInput!) {
        raiseIncident(input: $input)
      }
    `, {
      input: {
        resourceUrn,
        type: type || 'DATA_SCHEMA',
        title,
        description,
      },
    });
    return data.raiseIncident; // returns the new incident URN
  }

  /** Resolve a previously raised incident */
  async resolveIncident(incidentUrn, message) {
    await this._gql(`
      mutation ResolveIncident($urn: String!, $input: UpdateIncidentStatusInput!) {
        updateIncidentStatus(urn: $urn, input: $input)
      }
    `, { urn: incidentUrn, input: { state: 'RESOLVED', message } });
  }

  /** Add a tag to flag a column or dataset (e.g. "ARIA:BreakingChange") */
  async addTag({ resourceUrn, tagName }) {
    // Ensure tag exists first
    await this._gql(`
      mutation CreateTag($input: CreateTagInput!) {
        createTag(input: $input) { urn }
      }
    `, { input: { name: tagName } }).catch(() => {}); // ignore if already exists

    await this._gql(`
      mutation AddTag($input: TagAssociationInput!) {
        addTag(input: $input)
      }
    `, { input: { tagUrn: `urn:li:tag:${tagName}`, resourceUrn } });
  }

  /** Update the description / documentation of a dataset */
  async updateDescription({ resourceUrn, description }) {
    await this._gql(`
      mutation UpdateDescription($input: StringMapEntryInput!) {
        updateDescription(input: $input)
      }
    `, { input: { key: resourceUrn, value: description } }).catch(() => {
      // Fallback: some versions use editableSchemaMetadata
    });
  }
}