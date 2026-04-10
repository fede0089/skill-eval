import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { ListrEvalUI } from '../../src/utils/ui';

describe('ListrEvalUI', () => {
  it('should allow adding and running tasks', async (t) => {
    const ui = new ListrEvalUI();
    const taskMock = mock.fn(async (ctx: any) => {
      ctx.updateLog('Testing log');
    });

    ui.addTask({ id: '1', title: 'Task 1', task: taskMock });
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

    ui.addTask({ id: 'fail', title: 'Failing Task', task: failingTask });
    ui.addTask({ id: 'success', title: 'Succeeding Task', task: succeedingTask });
    
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
});
