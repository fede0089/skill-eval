import chalk from 'chalk';
import ora, { Ora } from 'ora';
import Table, { type TableConstructorOptions } from 'cli-table3';

export class Logger {
  static info(message: string): void {
    console.log(chalk.blue('ℹ'), message);
  }

  static error(message: string, error?: unknown): void {
    console.error(chalk.red('✖'), chalk.red(message), error || '');
  }

  static warn(message: string): void {
    console.warn(chalk.yellow('⚠'), chalk.yellow(message));
  }

  static success(message: string): void {
    console.log(chalk.green('✔'), chalk.green(message));
  }

  static debug(message: string): void {
    if (process.env.DEBUG) {
      console.log(chalk.gray('[Debug]'), message);
    }
  }

  static trace(error: Error | string): void {
    if (typeof error === 'string') {
      console.error(chalk.red('Trace:'), error);
      return;
    }
    console.error(chalk.red.bold(`\nTrace: ${error.message}`));
    if (error.stack) {
      const stack = error.stack
        .split('\n')
        .slice(1)
        .map(line => chalk.gray(line))
        .join('\n');
      console.error(stack);
    }
    console.error('');
  }

  static write(message: string): void {
    process.stdout.write(message);
  }

  static table(data: string[][], options: TableConstructorOptions = {}): void {
    const table = new Table({
      chars: {
        'top': '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
        'bottom': '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
        'left': '│', 'left-mid': '├', 'mid': '─', 'mid-mid': '┼',
        'right': '│', 'right-mid': '┤', 'middle': '│'
      },
      style: { head: ['cyan'], border: ['gray'] },
      ...options
    });

    table.push(...data);
    console.log(table.toString());
  }
}

export class Spinner {
  private spinner: Ora;

  constructor(prefix = '   Running agent') {
    this.spinner = ora({
      text: prefix,
      color: 'cyan',
      spinner: 'dots'
    });
  }

  public start(): void {
    this.spinner.start();
  }

  public updateLog(log: string): void {
    // Sanitize log to single line and limit length
    const sanitized = log.replace(/\n/g, ' ').trim();
    const truncated = sanitized.length > 60 ? sanitized.substring(0, 57) + '...' : sanitized;
    this.spinner.text = `${this.spinner.text.split(' [')[0]} [${truncated}]`;
  }

  public stop(finalMessage = 'Done.'): void {
    this.spinner.succeed(finalMessage);
  }

  public stopAndClear(): void {
    this.spinner.stop();
  }
}
