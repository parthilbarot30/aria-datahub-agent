{{ config(
    materialized='table',
    schema='analytics',
    tags=['finance', 'revenue', 'aria-fix']
) }}

-- ARIA Auto-Fix: fct_revenue
-- Incident: Column rename raw.payments.payment_method → payment_method_v2
-- Root cause: raw.payments schema bumped from v7 to v8 on 2024-05-14
-- ARIA investigation timestamp: 2024-05-15T02:31:44Z
-- Schemas pulled from DataHub at investigation time — column names verified

WITH payments AS (
    SELECT
        payment_id,
        order_id,
        customer_id,
        -- FIX: 'payment_method' was renamed to 'payment_method_v2' in raw.payments v8
        -- ARIA verified 'payment_method_v2' exists in current upstream schema
        payment_method_v2              AS payment_method,
        amount,
        currency,
        status,
        created_at,
        updated_at
    FROM {{ source('raw', 'payments') }}
    WHERE status != 'CANCELLED'
),

orders AS (
    SELECT
        order_id,
        customer_id,
        region,
        channel,
        created_at                     AS order_date
    FROM {{ source('raw', 'orders') }}
),

final AS (
    SELECT
        p.payment_id,
        p.order_id,
        p.customer_id,
        o.region,
        o.channel,
        p.payment_method,              -- resolved from payment_method_v2
        p.amount,
        p.currency,
        p.status,
        p.created_at,
        DATE_TRUNC('month', p.created_at) AS revenue_month
    FROM payments p
    LEFT JOIN orders o ON p.order_id = o.order_id
)

SELECT * FROM final