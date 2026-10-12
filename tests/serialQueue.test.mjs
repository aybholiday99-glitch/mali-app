import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SerialQueue } from '../src/services/serialQueue.ts';

test('new authentication waits for old logout cleanup and failures do not stall work', async () => {
  const queue = new SerialQueue();
  const order = [];
  let finishCleanup;
  const pending = new Promise(resolve => { finishCleanup = resolve; });
  const logout = queue.run(async () => { order.push('logout starts'); await pending; order.push('logout finished'); });
  const login = queue.run(async () => { order.push('new login'); return 'B'; });
  await Promise.resolve();
  assert.deepEqual(order,['logout starts']);
  finishCleanup();
  await logout;
  assert.equal(await login,'B');
  const failed = queue.run(async () => { throw new Error('network'); });
  await assert.rejects(failed,/network/);
  assert.equal(await queue.run(async () => 42),42);
  assert.deepEqual(order,['logout starts','logout finished','new login']);
});
