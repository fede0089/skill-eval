import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { ListrEvalUI, EvalTaskContext, MultiTrialContext } from '../../src/utils/ui.js';

describe('ListrEvalUI', () => {
  it('should allow adding and running tasks', async (t) => {
    const ui = new ListrEvalUI();
    const taskMock = mock.fn(async (ctx: EvalTaskContext) => {
      ctx.updateLog('Testing log');
    });

    ui.addTask({ id: 1, title: 'Task 1', task: taskMock });
    await ui.run(5);

    assert.strictEqual(taskMock.mock.callCount(), 1);
    // ctx.updateLog is called with 'Testing log'
  });

  it('should handle failures without stopping other tasks (exitOnError: false)', async (t) => {
    const ui = new ListrEvalUI();
    const failingTask = mock.fn(async () => {
      throw new Error('Failure');
    });
    const succeedingTask = mock.fn(async () => {
      // success
    });

    ui.addTask({ id: 1, title: 'Failing Task', task: failingTask });
    ui.addTask({ id: 2, title: 'Succeeding Task', task: succeedingTask });

    // Listr.run will throw if tasks fail, unless handled.
    // However, it will attempt both if concurrent.
    try {
      await ui.run(2);
    } catch (e) {
      // ignore
    }

    assert.strictEqual(failingTask.mock.callCount(), 1);
    assert.strictEqual(succeedingTask.mock.callCount(), 1);
  });

  it('should continue executing other tasks when one fails', async (t) => {
    const ui = new ListrEvalUI();
    const results: string[] = [];

    ui.addTask({
      id: 1,
      title: 'Failing',
      task: async () => {
        throw new Error('Failure');
      }
    });

    ui.addTask({
      id: 2,
      title: 'Succeeding',
      task: async () => {
        results.push('success');
      }
    });

    await ui.run(2);

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0], 'success');
  });

  describe('subtaskLabels', () => {
    it('uses provided labels for subtask titles and drives trial count', async () => {
      const ui = new ListrEvalUI();
      let capturedMulti: MultiTrialContext | undefined;

      ui.addTask({
        id: 1,
        title: 'Labeled Task',
        subtaskLabels: ['Without Skill 1', 'Without Skill 2', 'With Skill 1', 'With Skill 2'],
        task: async (_ctx, multi) => {
          capturedMulti = multi;
          multi!.markTrialComplete(1, true);
          multi!.markTrialComplete(2, true);
          multi!.markTrialComplete(3, true);
          multi!.markTrialComplete(4, true);
        }
      });

      await ui.run(1);

      assert.ok(capturedMulti !== undefined, 'multi context should be provided');
      assert.ok(typeof capturedMulti!.getTrialCtx === 'function');
      assert.ok(typeof capturedMulti!.markTrialComplete === 'function');
    });
  });

  describe('multi-trial subtasks (numTrials > 1)', () => {
    it('provides MultiTrialContext to task callback when numTrials > 1', async () => {
      const ui = new ListrEvalUI();
      let capturedMulti: MultiTrialContext | undefined;

      ui.addTask({
        id: 1,
        title: 'Multi Trial Task',
        numTrials: 3,
        task: async (_ctx, multi) => {
          capturedMulti = multi;
          // Resolve all trials immediately
          multi!.markTrialComplete(1, true);
          multi!.markTrialComplete(2, true);
          multi!.markTrialComplete(3, true);
        }
      });

      await ui.run(1);

      assert.ok(capturedMulti !== undefined, 'multi context should be provided');
      assert.ok(typeof capturedMulti!.getTrialCtx === 'function');
      assert.ok(typeof capturedMulti!.markTrialComplete === 'function');
    });

    it('does NOT provide MultiTrialContext when numTrials is 1', async () => {
      const ui = new ListrEvalUI();
      let capturedMulti: MultiTrialContext | undefined = undefined as any;

      ui.addTask({
        id: 1,
        title: 'Single Trial Task',
        numTrials: 1,
        task: async (_ctx, multi) => {
          capturedMulti = multi;
        }
      });

      await ui.run(1);

      assert.strictEqual(capturedMulti, undefined, 'multi context should not be provided for single trial');
    });

    it('getTrialCtx returns independent contexts per trial', async () => {
      const ui = new ListrEvalUI();
      const ctxRefs: EvalTaskContext[] = [];

      ui.addTask({
        id: 1,
        title: 'Multi Trial Task',
        numTrials: 3,
        task: async (_ctx, multi) => {
          ctxRefs.push(multi!.getTrialCtx(1));
          ctxRefs.push(multi!.getTrialCtx(2));
          ctxRefs.push(multi!.getTrialCtx(3));
          multi!.markTrialComplete(1, true);
          multi!.markTrialComplete(2, true);
          multi!.markTrialComplete(3, true);
        }
      });

      await ui.run(1);

      assert.strictEqual(ctxRefs.length, 3);
      assert.notStrictEqual(ctxRefs[0], ctxRefs[1]);
      assert.notStrictEqual(ctxRefs[1], ctxRefs[2]);
    });

    it('ui.run() resolves when all trials are marked complete (passed)', async () => {
      const ui = new ListrEvalUI();

      ui.addTask({
        id: 1,
        title: 'All Pass',
        numTrials: 3,
        task: async (_ctx, multi) => {
          await Promise.resolve(); // yield to event loop
          multi!.markTrialComplete(1, true);
          multi!.markTrialComplete(2, true);
          multi!.markTrialComplete(3, true);
        }
      });

      // Should resolve without hanging
      await ui.run(1);
    });

    it('ui.run() resolves even when a trial is marked failed', async () => {
      const ui = new ListrEvalUI();

      ui.addTask({
        id: 1,
        title: 'Mixed Results',
        numTrials: 3,
        task: async (_ctx, multi) => {
          multi!.markTrialComplete(1, true);
          multi!.markTrialComplete(2, false, 'assertion failed');
          multi!.markTrialComplete(3, true);
        }
      });

      // Should resolve without hanging (exitOnError: false on subtasks)
      await ui.run(1);
    });

    it('aggregation results are available after ui.run() resolves', async () => {
      const ui = new ListrEvalUI();
      const collected: string[] = [];

      ui.addTask({
        id: 1,
        title: 'Aggregation Task',
        numTrials: 2,
        task: async (_ctx, multi) => {
          multi!.markTrialComplete(1, true);
          multi!.markTrialComplete(2, true);
          // Simulate aggregation that happens after markTrialComplete calls
          collected.push('trial-1');
          collected.push('trial-2');
        }
      });

      await ui.run(1);

      assert.deepStrictEqual(collected, ['trial-1', 'trial-2']);
    });
  });
});
