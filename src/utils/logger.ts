export class Logger {
  static info(message: string): void {
    console.log(message);
  }

  static error(message: string, error?: unknown): void {
    console.error(`[Error] ${message}`, error || '');
  }

  static warn(message: string): void {
    console.warn(`[Warning] ${message}`);
  }

  static success(message: string): void {
    console.log(`[Success] ${message}`);
  }

  static debug(message: string): void {
    if (process.env.DEBUG) {
      console.log(`[Debug] ${message}`);
    }
  }

  static write(message: string): void {
    process.stdout.write(message);
  }
}

export class Spinner {
  private static readonly frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private interval: NodeJS.Timeout | null = null;
  private currentFrame = 0;
  private lastLog = '';
  private prefix = '';

  constructor(prefix = '   Running agent') {
    this.prefix = prefix;
  }

  public start(): void {
    if (this.interval) return;
    
    // Hide cursor
    process.stdout.write('\x1B[?25l');
    
    this.render();
    this.interval = setInterval(() => {
      this.currentFrame = (this.currentFrame + 1) % Spinner.frames.length;
      this.render();
    }, 80);
  }

  public updateLog(log: string): void {
    // Sanitize log to single line and limit length
    this.lastLog = log.replace(/\n/g, ' ').trim();
    if (this.lastLog.length > 60) {
      this.lastLog = this.lastLog.substring(0, 57) + '...';
    }
  }

  public stop(finalMessage = 'Done.'): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    // Clear line, show cursor, and print final message
    process.stdout.write(`\r\x1b[2K${this.prefix}... ${finalMessage}\n`);
    process.stdout.write('\x1B[?25h');
  }

  private render(): void {
    const frame = Spinner.frames[this.currentFrame];
    const logPart = this.lastLog ? ` \x1b[90m[${this.lastLog}]\x1b[39m` : '';
    process.stdout.write(`\r\x1b[2K   ${frame} ${this.prefix}...${logPart}`);
  }
}
