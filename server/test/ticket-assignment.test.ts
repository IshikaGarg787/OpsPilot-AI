import test from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { assignedUserId } from '../src/routes/ticketRoutes.js';

test('assignedUserId resolves a populated IT Team assignee', () => {
  const id = new Types.ObjectId();
  assert.equal(assignedUserId({ assignedTo: { _id: id, name: 'IT Teammate', email: 'it@example.com' } }), id.toString());
});

test('assignedUserId resolves an unpopulated ObjectId reference', () => {
  const id = new Types.ObjectId();
  assert.equal(assignedUserId({ assignedTo: id }), id.toString());
});

test('assignedUserId resolves a stored string reference', () => {
  const id = new Types.ObjectId().toString();
  assert.equal(assignedUserId({ assignedTo: id }), id);
});

test('assignedUserId returns null for unassigned or malformed values', () => {
  assert.equal(assignedUserId({ assignedTo: null }), null);
  assert.equal(assignedUserId({}), null);
  assert.equal(assignedUserId({ assignedTo: {} }), null);
});
