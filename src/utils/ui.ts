import { Listr, ListrTask } from 'listr2';

/**
 * Interface for providing task progress and status updates
 */
export interface EvalTaskContext {
  updateLog(log: string): void;
}

export type EvalTaskFn = (ctx: EvalTaskContext) => Promise<void>;

/**
 * Descriptor for a single task to be executed by the UI
 */
export interface EvalTaskDescriptor {
  id: string;
  title: string;
  task: EvalTaskFn;
}

/**
 * Listr implementation for rendering parallel task progress
 */
export class ListrEvalUI {
  private tasks: ListrTask<any, any>[] = [];

  addTask(descriptor: EvalTaskDescriptor): void {
    this.tasks.push({
      title: descriptor.title,
      task: async (ctx, task) => {
        const evalCtx: EvalTaskContext = {
          updateLog: (log: string) => {
            const sanitized = log.replace(/\n/g, ' ').trim();
            const truncated = sanitized.length > 50 ? sanitized.substring(0, 47) + '...' : sanitized;
            task.output = truncated;
          }
        };
        try {
          await descriptor.task(evalCtx);
        } catch (error) {
          if (error instanceof Error) {
            error.message = `${descriptor.title} - ${error.message}`;
          }
          throw error;
        }
      }
    });
  }

  async run(concurrency: number): Promise<void> {
    if (this.tasks.length === 0) return;

    // Use verbose renderer in non-TTY or tests to avoid hangs and provide clearer logs
    const isTTY = process.stdout.isTTY;
    const isTest = process.env.NODE_ENV === 'test' || process.env.CI === 'true';

    const listr = new Listr(this.tasks, {
      concurrent: concurrency,
      exitOnError: false, // Continue other tasks if one fails
      renderer: (isTTY && !isTest) ? 'default' : 'verbose',
      rendererOptions: {
        collapseSubtasks: false,
        formatOutput: 'wrap'
      }
    });

    try {
      await listr.run();
    } catch (error) {
      // Listr throws if any task fails even with exitOnError: false.
      // We catch it here because we handle the results/errors ourselves in the caller.
    }
  }
}
