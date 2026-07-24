# Incident 003 — ML Feature Store Column Missing: `user_churn_score_v3`

**Error:**

MLflow training job ml-churn-model-v4 FAILED at step: feature_extraction

KeyError: 'user_churn_score_v3'
Feature column 'user_churn_score_v3' not found in feature store dataset ml_features_prod.
Available columns: user_churn_score_v2, user_engagement_score, ltv_30d

This feature was referenced in training config: configs/churn_model_v4.yaml


**ARIA Diagnosis:**
- Root cause: `ml_features_prod` feature store updated to v4 schema, deprecating `user_churn_score_v3`. Training config still referenced the old column name.
- Breaking change type: `COLUMN_MISSING`
- Blast radius: **2 downstream assets** (churn-model-v4 training job, real-time scoring pipeline)
- Severity: **MEDIUM**
- ML-specific: DataHub ML lineage traversed from feature store → model → deployment endpoint
- Estimated fix time: ~30 minutes

**Generated artifacts:** training_config_fix.yaml, data-contract.yaml, postmortem.md