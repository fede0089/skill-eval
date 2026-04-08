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
