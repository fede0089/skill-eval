import { Listr, ListrTask } from 'listr2';

/**
 * Interface for providing task progress and status updates
 */
export interface EvalTaskContext {
  updateLog(log: string): void;
}

/**
 * Context for multi-trial tasks, providing per-trial spinners via listr2 subtasks.
 * Only provided to the task callback when numTrials > 1.
 */
export interface MultiTrialContext {
  /** Returns an EvalTaskContext whose updateLog writes to the given trial's subtask output */
  getTrialCtx(trialId: number): EvalTaskContext;
  /** Resolves or rejects the deferred promise for the given trial's subtask */
  markTrialComplete(trialId: number, passed: boolean, failureReason?: string): void;
}

export type EvalTaskFn = (ctx: EvalTaskContext, multi?: MultiTrialContext) => Promise<void>;

/**
 * Descriptor for a single task to be executed by the UI
 */
export interface EvalTaskDescriptor {
  id: string | number;
  title: string;
  /** When > 1, creates one listr2 subtask ("Trial N") per trial with its own spinner */
  numTrials?: number;
  task: EvalTaskFn;
}

function sanitizeLog(log: string, maxLen = 50): string {
  const sanitized = log.replace(/\n/g, ' ').trim();
  return sanitized.length > maxLen ? sanitized.substring(0, maxLen - 3) + '...' : sanitized;
}

/**
 * Listr implementation for rendering parallel task progress
 */
export class ListrEvalUI {
  private tasks: ListrTask<unknown, any>[] = [];

  addTask(descriptor: EvalTaskDescriptor): void {
    const numTrials = descriptor.numTrials ?? 0;

    if (numTrials <= 1) {
      // Single-trial path: existing behaviour unchanged
      this.tasks.push({
        title: descriptor.title,
        task: async (ctx, task) => {
          let taskDone = false;
          const evalCtx: EvalTaskContext = {
            updateLog: (log: string) => {
              if (taskDone) return;
              task.output = sanitizeLog(log);
            }
          };
          try {
            await descriptor.task(evalCtx);
          } catch (error) {
            if (error instanceof Error) {
              error.message = `${descriptor.title} - ${error.message}`;
            }
            throw error;
          } finally {
            taskDone = true;
          }
        }
      });
      return;
    }

    // Multi-trial path: one listr2 subtask per trial, each backed by a deferred promise
    this.tasks.push({
      title: descriptor.title,
      task: (ctx, parentTask) => {
        type Deferred = { resolve: () => void; reject: (e: Error) => void };
        const deferreds: Deferred[] = [];
        const outputSetters: Array<(s: string) => void> = Array.from(
          { length: numTrials },
          () => () => {}
        );
        const trialDone: boolean[] = new Array(numTrials).fill(false);

        const subtasks = Array.from({ length: numTrials }, (_, idx) => {
          let resolve!: () => void, reject!: (e: Error) => void;
          const promise = new Promise<void>((res, rej) => {
            resolve = res;
            reject = rej;
          });
          deferreds.push({ resolve, reject });

          return {
            title: `Trial ${idx + 1}`,
            task: async (_: unknown, subtask: any) => {
              outputSetters[idx] = (s: string) => {
                subtask.output = s;
              };
              await promise;
            }
          };
        });

        const multiCtx: MultiTrialContext = {
          getTrialCtx: (trialId: number) => ({
            updateLog: (log: string) => {
              const i = trialId - 1;
              if (trialDone[i]) return;
              outputSetters[i](sanitizeLog(log));
            }
          }),
          markTrialComplete: (trialId: number, passed: boolean, failureReason?: string) => {
            const i = trialId - 1;
            if (trialDone[i]) return;
            trialDone[i] = true;
            if (passed) {
              deferreds[i].resolve();
            } else {
              deferreds[i].reject(new Error(failureReason ?? 'Trial failed'));
            }
          }
        };

        // Fire-and-forget: task runs concurrently with the subtask lifecycle.
        // Aggregation inside descriptor.task() completes before ui.run() resolves
        // because markTrialComplete() is called before each .then() returns,
        // so all deferreds are resolved before Promise.all() inside descriptor.task() resolves.
        descriptor.task({ updateLog: () => {} }, multiCtx).catch((unexpectedError) => {
          // Reject any pending deferreds so subtasks don't hang
          const err = unexpectedError instanceof Error
            ? unexpectedError
            : new Error(String(unexpectedError));
          deferreds.forEach((d, i) => {
            if (!trialDone[i]) {
              trialDone[i] = true;
              try { d.reject(err); } catch (_) {}
            }
          });
        });

        return parentTask.newListr(subtasks, { concurrent: true, exitOnError: false });
      }
    });
  }

  async run(concurrency: number): Promise<void> {
    if (this.tasks.length === 0) return;

    // Use simple renderer in non-TTY or tests to avoid hangs and provide clearer logs
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
