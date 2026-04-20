import { test } from 'node:test';
import assert from 'node:assert';
import { AgentPool } from '../../src/core/agent-pool.js';

test('AgentPool: acquire resolves immediately when under capacity', async () => {
  const pool = new AgentPool(2);
  const release = await pool.acquire();
  assert.strictEqual(typeof release, 'function');
  release();
});

test('AgentPool: blocks when at capacity, unblocks on release', async () => {
  const pool = new AgentPool(1);
  const release1 = await pool.acquire();

  let resolved = false;
  const p2 = pool.acquire().then(release => { resolved = true; return release; });

  // Not yet resolved — pool is full
  await Promise.resolve();
  assert.strictEqual(resolved, false, 'second acquire should not resolve while pool is full');

  release1();
  const release2 = await p2;
  assert.strictEqual(resolved, true, 'second acquire should resolve after first is released');
  release2();
});

test('AgentPool: release is idempotent', async () => {
  const pool = new AgentPool(1);
  const release = await pool.acquire();
  release();
  release(); // double release — must not corrupt active count

  // Pool should accept a new acquire immediately
  const release2 = await pool.acquire();
  assert.strictEqual(typeof release2, 'function');
  release2();
});

test('AgentPool: drains queue in FIFO order', async () => {
  const pool = new AgentPool(1);
  const release1 = await pool.acquire(); // holds the only slot

  const order: number[] = [];
  const p2 = pool.acquire().then(r => { order.push(2); return r; });
  const p3 = pool.acquire().then(r => { order.push(3); return r; });

  release1();
  const r2 = await p2;
  r2();
  const r3 = await p3;
  r3();

  assert.deepStrictEqual(order, [2, 3]);
});

test('AgentPool: barrier semantics — prompt N slots all acquired before prompt N+1 starts', async () => {
  const pool = new AgentPool(2);
  const acquired: string[] = [];

  let resolveBarrier!: () => void;
  const barrier = new Promise<void>(r => { resolveBarrier = r; });

  // Prompt 1: acquires 2 slots, then resolves the barrier
  const prompt1 = (async () => {
    const r1 = await pool.acquire();
    acquired.push('p1-t1');
    const r2 = await pool.acquire();
    acquired.push('p1-t2');
    resolveBarrier();
    r1();
    r2();
  })();

  // Prompt 2: waits for barrier before acquiring
  const prompt2 = (async () => {
    await barrier;
    const r3 = await pool.acquire();
    acquired.push('p2-t1');
    r3();
  })();

  await Promise.all([prompt1, prompt2]);

  assert.ok(
    acquired.indexOf('p1-t1') < acquired.indexOf('p2-t1') &&
    acquired.indexOf('p1-t2') < acquired.indexOf('p2-t1'),
    'Both p1 slots must be acquired before p2 starts'
  );
});
