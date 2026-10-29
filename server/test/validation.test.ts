import test from 'node:test';
import assert from 'node:assert/strict';
import { resolutionPredictionSchema, signupSchema } from '../src/validators/schemas.js';

test('resolution input keeps the prediction-time contract', () => {
  const parsed = resolutionPredictionSchema.parse({ issue_created: '2024-01-12T09:30:00Z', issue_priority: 'High', issue_type: 'Bug', issue_proj: 'C00d3dzwj28av.ew8x3' });
  assert.equal(parsed.issue_priority, 'High');
  assert.throws(() => resolutionPredictionSchema.parse({ issue_created: 'not-a-date', issue_priority: 'High', issue_type: 'Bug' }));
});

test('signup validation requires accepted terms and a valid email', () => {
  assert.throws(() => signupSchema.parse({ name: 'A', email: 'invalid', password: 'short', termsAccepted: false }));
  const parsed = signupSchema.parse({ name: 'Alex Morgan', email: 'Alex@Example.com', password: 'long-enough-password', termsAccepted: true });
  assert.equal(parsed.email, 'alex@example.com');
});
