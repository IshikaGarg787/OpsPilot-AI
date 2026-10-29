# ML integration guide

This guide lets a teammate add a verified model without rewriting authentication, navigation, persistence, theme handling, or the existing resolution module.

## Required handoff

Provide the following before a model is marked available:

1. Model ID and display name.
2. Product description and intended prediction time.
3. Exact input schema, including accepted categories and units.
4. Exact output schema, including whether output is a point estimate, class, probability, or forecast.
5. Python inference entry point or service endpoint.
6. Artifact location and loading requirements.
7. Health-check endpoint and unavailable behavior.
8. Dependency requirements with pinned compatible versions.
9. Evaluation metrics, dataset context, and evaluation split.
10. Example request and response with clearly labeled non-production fixtures.
11. Known limitations, leakage decisions, and unsupported inputs.

## Python service contract

Create a sibling adapter beside `resolution_api.py`. It should:

- load the artifact once at startup;
- expose `GET /health` with `available` only when the artifact is loaded;
- expose `GET /metadata` with the verified schema and metrics;
- expose a versioned inference endpoint;
- validate input with Pydantic;
- return a typed, finite result;
- return 422 for invalid inputs and 503 for unavailable artifacts;
- never train or mutate an artifact on startup.

Keep the inference function separate from FastAPI so it can be smoke-tested directly. Add a real-artifact test similar to `ml/test_resolution_api.py`.

## Express registration

1. Add the model to `baseModels` in `server/src/services/modelRegistry.ts`.
2. Add a health/metadata call in `server/src/services/mlService.ts` or a model-specific service wrapper.
3. Add a validated route under `server/src/routes/predictionRoutes.ts` or a focused route module.
4. Validate the upstream response before saving it.
5. Add a model-specific input/output mapping to `PredictionModel` if the shared shape is not sufficient.
6. Keep user ownership in every history query and detail route.
7. Return an explicit error when the model is unavailable. Never return a fallback prediction.

The registry should report `coming_soon` while the model is being built, `unavailable` when implemented but unhealthy, and `available` only after health and end-to-end checks pass.

## Frontend registration

1. Add the model entry to the shared model center response.
2. Add a route under the protected `AppShell`.
3. Use the metadata endpoint for dropdown options and field labels.
4. Reuse `Card`, `Notice`, `StatusPill`, loading, empty, and error states.
5. Render only the actual model response and label its unit and prediction type.
6. Add the model to history filters and details if it is persisted.
7. Keep the page visibly unavailable until the backend registry says it is available.

## Metrics and responsible display

Metrics must include the evaluation split and dataset context. Keep validation metrics separate from untouched test metrics. Do not present prediction history as accuracy: accuracy requires observed labels. Do not add confidence intervals unless the model has calibrated uncertainty support.

## Integration checklist

```text
[ ] Artifact path is configurable and not committed as a secret
[ ] FastAPI health endpoint reports unavailable on missing artifact
[ ] Metadata lists verified input options
[ ] Direct inference smoke test passes with the real artifact
[ ] Express validates upstream response
[ ] User-scoped history persists and reloads
[ ] Frontend has loading, empty, error, and unavailable states
[ ] Metrics and limitations are shown with their split
[ ] Model remains coming_soon until end-to-end verification passes
```
