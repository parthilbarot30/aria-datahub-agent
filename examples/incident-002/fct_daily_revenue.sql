{{ config(
    materialized='table',
    schema='analytics',
    tags=['finance', 'revenue', 'aria-fix']
) }}

-- ARIA Auto-Fix: fct_daily_revenue
-- Incident: Freshness SLA breach — table not updated in 36 hours
-- Root cause: Upstream ingestion DAG failed silently, no freshness assertion existed
-- Generated: 2024-05-15T02:31:44Z
-- Schema pulled from DataHub at investigation time

WITH orders AS (
    SELECT * FROM {{ source('raw', 'orders') }}
),

payments AS (
    SELECT * FROM {{ source('raw', 'payments') }}
),

final AS (
    SELECT
        DATE_TRUNC('day', o.created_at)     AS revenue_date,
        COALESCE(SUM(p.amount), 0)          AS daily_revenue,
        COUNT(DISTINCT o.id)                AS order_count,
        COUNT(DISTINCT p.payment_id)        AS payment_count
    FROM orders o
    LEFT JOIN payments p ON o.id = p.order_id
    WHERE p.status = 'COMPLETED'
    GROUP BY DATE_TRUNC('day', o.created_at)
)

SELECT * FROM final