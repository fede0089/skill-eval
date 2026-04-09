"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Spinner = exports.Logger = void 0;
class Logger {
    static info(message) {
        console.log(message);
    }
    static error(message, error) {
        console.error(`[Error] ${message}`, error || '');
    }
    static warn(message) {
        console.warn(`[Warning] ${message}`);
    }
    static success(message) {
        console.log(`[Success] ${message}`);
    }
    static debug(message) {
        if (process.env.DEBUG) {
            console.log(`[Debug] ${message}`);
        }
    }
    static write(message) {
        process.stdout.write(message);
    }
}
exports.Logger = Logger;
class Spinner {
    static frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    interval = null;
    currentFrame = 0;
    lastLog = '';
    prefix = '';
    constructor(prefix = '   Running agent') {
        this.prefix = prefix;
    }
    start() {
        if (this.interval)
            return;
        // Hide cursor
        process.stdout.write('\x1B[?25l');
        this.render();
        this.interval = setInterval(() => {
            this.currentFrame = (this.currentFrame + 1) % Spinner.frames.length;
            this.render();
        }, 80);
    }
    updateLog(log) {
        // Sanitize log to single line and limit length
        this.lastLog = log.replace(/\n/g, ' ').trim();
        if (this.lastLog.length > 60) {
            this.lastLog = this.lastLog.substring(0, 57) + '...';
        }
    }
    stop(finalMessage = 'Done.') {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        // Clear line, show cursor, and print final message
        process.stdout.write(`\r\x1b[2K${this.prefix}... ${finalMessage}\n`);
        process.stdout.write('\x1B[?25h');
    }
    render() {
        const frame = Spinner.frames[this.currentFrame];
        const logPart = this.lastLog ? ` \x1b[90m[${this.lastLog}]\x1b[39m` : '';
        process.stdout.write(`\r\x1b[2K   ${frame} ${this.prefix}...${logPart}`);
    }
}
exports.Spinner = Spinner;
