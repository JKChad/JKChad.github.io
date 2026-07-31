import assert from 'node:assert/strict';
import { AttentionModel } from '../attention/AttentionModel.js';
import { MovementPredictor } from './NetSession.js';
import { simulateMovement } from './simulateMovement.js';

function approx(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ~= ${expected}`);
}

function testAttentionAuthority() {
  const host = new AttentionModel({ transferRate: 50 });
  const client = new AttentionModel({ transferRate: 50 });

  const intent = { type: 'attention:intent', seat: 1, dir: 1 };
  assert.equal(intent.type, 'attention:intent');
  assert.deepEqual(client.snapshot().p0, 50);
  assert.deepEqual(client.snapshot().p1, 50);

  host.setTransferIntent(intent.seat, intent.dir);
  host.update(0.5);
  const snap = host.snapshot();
  assert.equal(snap.p0, 25);
  assert.equal(snap.p1, 75);

  client.applySnapshot(snap);
  assert.equal(client.snapshot().p0, snap.p0);
  assert.equal(client.snapshot().p1, snap.p1);

  client.setTransferIntent(0, 1);
  assert.equal(client.snapshot().p0, snap.p0, 'client intent alone must not mutate shares');
  client.applySnapshot({ p0: 90, revision: snap.revision - 1 });
  assert.equal(client.snapshot().p0, snap.p0, 'stale snapshots are ignored');
}

function testMovementReconcile() {
  const predictor = new MovementPredictor();
  const origin = { x: 0, y: 0, z: 7.2, yaw: 0, pitch: 0, vx: 0, vz: 0, seq: 0 };
  const inputs = [
    { seq: 1, dt: 1 / 60, mx: 0, my: 1, yaw: 0, pitch: 0, b: 0 },
    { seq: 2, dt: 1 / 60, mx: 0, my: 1, yaw: 0, pitch: 0, b: 0 },
    { seq: 3, dt: 1 / 60, mx: 1, my: 0, yaw: 0, pitch: 0, b: 1 },
  ];

  let predicted = origin;
  for (const input of inputs) {
    predicted = simulateMovement(predicted, input);
    predictor.pushInput(input.seq, input, predicted);
  }

  let hostAck = simulateMovement(origin, inputs[0]);
  hostAck = simulateMovement(hostAck, inputs[1]);
  hostAck = { ...hostAck, x: hostAck.x + 0.125, seq: 2 };

  const corrected = predictor.reconcile(hostAck, simulateMovement);
  const expected = simulateMovement(
    {
      x: hostAck.x,
      y: hostAck.y,
      z: hostAck.z,
      yaw: hostAck.yaw,
      pitch: hostAck.pitch,
    },
    inputs[2],
  );

  assert.equal(predictor.pending.length, 1);
  assert.equal(predictor.pending[0].seq, 3);
  approx(corrected.x, expected.x);
  approx(corrected.z, expected.z);
  approx(corrected.seq, expected.seq);
}

testAttentionAuthority();
testMovementReconcile();
console.log('netTest ok');
