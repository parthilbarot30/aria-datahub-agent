import axios from 'axios';

const DH = 'http://localhost:8080';
const headers = { 'Content-Type': 'application/json' };

async function upsertDataset(urn, name, platform, fields, description) {
  const encoded = encodeURIComponent(urn);
  
  // Use OpenAPI v3
  await axios.post(`${DH}/openapi/v3/entity/dataset`, [{
    urn,
    datasetProperties: {
      value: {
        name,
        description,
        customProperties: {}
      }
    },
    schemaMetadata: {
      value: {
        schemaName: name,
        platform: `urn:li:dataPlatform:${platform}`,
        version: 1,
        hash: '',
        platformSchema: { com: { linkedin: { schema: { OtherSchema: { inputSchema: '' } } } } },
        fields: fields.map(f => ({
          fieldPath: f.name,
          description: f.description || '',
          nativeDataType: f.type,
          nullable: false,
          type: {
            type: {
              com: {
                linkedin: {
                  schema: {
                    SchemaFieldDataType: {
                      type: f.type === 'DOUBLE' ? { NumberType: {} } :
                            f.type === 'TIMESTAMP' || f.type === 'DATE' ? { TimeType: {} } :
                            { StringType: {} }
                    }
                  }
                }
              }
            }
          }
        }))
      }
    },
    status: { value: { removed: false } }
  }], { headers });

  console.log(`✓ Created: ${name}`);
}

async function addLineage(upstreamUrn, downstreamUrn) {
  await axios.post(`${DH}/openapi/v3/entity/dataset`, [{
    urn: downstreamUrn,
    upstreamLineage: {
      value: {
        upstreams: [{
          dataset: upstreamUrn,
          type: 'TRANSFORMED',
          auditStamp: {
            time: Date.now(),
            actor: 'urn:li:corpuser:datahub'
          }
        }]
      }
    }
  }], { headers });
}
async function addDownstreamLineage(downstreamUrn, upstreamUrns) {
  await axios.post(`${DH}/openapi/v3/entity/dataset`, [{
    urn: downstreamUrn,
    upstreamLineage: {
      value: {
        upstreams: upstreamUrns.map(u => ({
          dataset: u,
          type: 'TRANSFORMED',
          auditStamp: { time: Date.now(), actor: 'urn:li:corpuser:datahub' }
        }))
      }
    }
  }], { headers });
  console.log(`✓ Downstream lineage added for ${downstreamUrn}`);
}

async function seed() {
  console.log('Seeding DataHub...\n');

  const RAW_PAYMENTS = 'urn:li:dataset:(urn:li:dataPlatform:snowflake,raw.payments,PROD)';
  const RAW_ORDERS   = 'urn:li:dataset:(urn:li:dataPlatform:snowflake,raw.orders,PROD)';
  const FCT_REVENUE  = 'urn:li:dataset:(urn:li:dataPlatform:dbt,analytics.fct_revenue,PROD)';
  const ROLLUP       = 'urn:li:dataset:(urn:li:dataPlatform:dbt,analytics.monthly_revenue_rollup,PROD)';
  const ML_FEATURES  = 'urn:li:dataset:(urn:li:dataPlatform:dbt,analytics.ml_training_features,PROD)';

  await upsertDataset(RAW_PAYMENTS, 'raw.payments', 'snowflake', [
    { name: 'payment_id',        type: 'STRING',    description: 'Primary key' },
    { name: 'order_id',          type: 'STRING',    description: 'FK to orders' },
    { name: 'payment_method_v2', type: 'STRING',    description: 'Renamed from payment_method in schema v8' },
    { name: 'amount',            type: 'DOUBLE',    description: 'Payment amount' },
    { name: 'status',            type: 'STRING',    description: 'Payment status' },
    { name: 'created_at',        type: 'TIMESTAMP', description: 'Event timestamp' },
  ], 'Raw payments. Schema v8 - payment_method renamed to payment_method_v2.');

  await upsertDataset(RAW_ORDERS, 'raw.orders', 'snowflake', [
    { name: 'order_id',    type: 'STRING',    description: 'Primary key' },
    { name: 'customer_id', type: 'STRING',    description: 'Customer reference' },
    { name: 'region',      type: 'STRING',    description: 'Order region' },
    { name: 'channel',     type: 'STRING',    description: 'Sales channel' },
    { name: 'created_at',  type: 'TIMESTAMP', description: 'Order timestamp' },
  ], 'Raw orders from order management system.');

  await upsertDataset(FCT_REVENUE, 'fct_revenue', 'dbt', [
    { name: 'payment_id',     type: 'STRING' },
    { name: 'order_id',       type: 'STRING' },
    { name: 'customer_id',    type: 'STRING' },
    { name: 'payment_method', type: 'STRING', description: 'BROKEN - should be payment_method_v2' },
    { name: 'amount',         type: 'DOUBLE' },
    { name: 'region',         type: 'STRING' },
    { name: 'revenue_month',  type: 'DATE' },
  ], 'Core revenue fact table. BROKEN - payment_method renamed upstream.');

  await upsertDataset(ROLLUP, 'monthly_revenue_rollup', 'dbt', [
    { name: 'revenue_month', type: 'DATE' },
    { name: 'total_revenue', type: 'DOUBLE' },
    { name: 'region',        type: 'STRING' },
  ], 'Monthly revenue rollup. Downstream of fct_revenue.');

  await upsertDataset(ML_FEATURES, 'ml_training_features', 'dbt', [
    { name: 'customer_id',    type: 'STRING' },
    { name: 'total_spend',    type: 'DOUBLE' },
    { name: 'payment_method', type: 'STRING' },
  ], 'ML churn model features. Downstream of fct_revenue.');

  console.log('\nAdding lineage...');
await addDownstreamLineage(FCT_REVENUE, [RAW_PAYMENTS, RAW_ORDERS]);
await addDownstreamLineage(ROLLUP, [FCT_REVENUE]);
await addDownstreamLineage(ML_FEATURES, [FCT_REVENUE]);
console.log('✓ Lineage added');
  console.log('\n✅ Done! Search for "fct_revenue" at http://localhost:9002');
}

seed().catch(e => {
  console.error('Error:', e.response?.data || e.message);
});