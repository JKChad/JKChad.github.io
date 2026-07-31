import assert from 'node:assert/strict';
import { AttentionModel } from '../attention/AttentionModel.js';
import { NetGameBridge } from '../../net/NetGameBridge.js';
import { MSG, MovementPredictor, NetSession, decode } from './NetSession.js';
import { simulateMovement } from './simulateMovement.js';

function approx(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ~= ${expected}`);
}

function testAttentionAuthority() {
  const host = new AttentionModel({ transferRate: 50 });
  const client = new AttentionModel({ transferRate: 50, locked: true });

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
  client.update(0.5);
  client.spikeToward(0, 30);
  assert.equal(client.snapshot().p0, snap.p0, 'locked client mutation must not alter shares');
  client.applySnapshot({ p0: 90, revision: snap.revision - 1 });
  assert.equal(client.snapshot().p0, snap.p0, 'stale snapshots are ignored');

  client.spikeToward(0, 10, { authority: true });
  assert.equal(client.snapshot().p0, snap.p0 + 10, 'authority override can mutate locked model');
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

function testInputReplayWindow() {
  const sent = [];
  const session = new NetSession({ isHost: false, localSeat: 1 });
  session.connected = true;
  session.attachTransport((raw) => sent.push(decode(raw)));

  for (let seq = 1; seq <= 9; seq += 1) {
    const input = { seq, dt: 1 / 60, mx: seq % 2, my: 1, yaw: 0, pitch: 0, b: 0 };
    session.sendLocalInput(input, { x: seq * 1000, y: 0, z: seq * 1000, yaw: 0, pitch: 0 });
  }

  const last = sent.at(-1);
  assert.equal(last.t, MSG.INPUT);
  assert.equal(last.state, undefined, 'input packets must not include client-authored position');
  assert.equal(last.inputs.length, 8, 'client resends the last 8 unacked inputs');
  assert.deepEqual(last.inputs.map((input) => input.seq), [2, 3, 4, 5, 6, 7, 8, 9]);
}

function testHostLostInputCatchupIgnoresClientState() {
  const applied = [];
  const bridge = new NetGameBridge({
    applyRemoteState: (seat, state, options) => applied.push({ seat, state, options }),
  });
  bridge.active = true;
  bridge.isHost = true;
  bridge.localSeat = 0;
  bridge.remoteSeat = 1;

  const origin = { x: 0, y: 0, z: 7.2, yaw: 0, pitch: 0, vx: 0, vz: 0, seq: 0 };
  const inputs = [
    { seq: 1, dt: 1 / 60, mx: 0, my: 1, yaw: 0, pitch: 0, b: 0 },
    { seq: 2, dt: 1 / 60, mx: 0, my: 1, yaw: 0, pitch: 0, b: 1 },
    { seq: 3, dt: 1 / 60, mx: 1, my: 0, yaw: 0, pitch: 0, b: 3 },
  ];

  const first = simulateMovement(origin, inputs[0]);
  bridge._remoteStates.set(1, first);
  bridge._handleRemoteInput({
    seat: 1,
    input: inputs[2],
    inputs,
    state: { x: 999, y: 0, z: 999, yaw: Math.PI, pitch: 1, vx: 999, vz: 999, seq: 3 },
  });

  const expected = inputs.slice(1).reduce((state, input) => simulateMovement(state, input), first);
  const final = applied.at(-1).state;
  approx(final.x, expected.x);
  approx(final.z, expected.z);
  assert.equal(final.seq, 3);
  assert.notEqual(final.x, 999, 'host must ignore client-authored state position');
  assert.equal(final.walk, true);
  assert.equal(final.crouch, true);
  assert.deepEqual(applied.at(-1).options.inputs.map((input) => input.seq), [2, 3]);
}

testAttentionAuthority();
testMovementReconcile();
testInputReplayWindow();
testHostLostInputCatchupIgnoresClientState();
console.log('netTest ok');
