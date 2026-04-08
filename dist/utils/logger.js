"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
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
