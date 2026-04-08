"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValidationError = exports.ExecutionError = exports.ConfigError = exports.AppError = void 0;
class AppError extends Error {
    message;
    code;
    constructor(message, code = 'GENERIC_ERROR') {
        super(message);
        this.message = message;
        this.code = code;
        this.name = this.constructor.name;
        Object.setPrototypeOf(this, AppError.prototype);
    }
}
exports.AppError = AppError;
class ConfigError extends AppError {
    constructor(message) {
        super(message, 'CONFIG_ERROR');
        Object.setPrototypeOf(this, ConfigError.prototype);
    }
}
exports.ConfigError = ConfigError;
class ExecutionError extends AppError {
    constructor(message) {
        super(message, 'EXECUTION_ERROR');
        Object.setPrototypeOf(this, ExecutionError.prototype);
    }
}
exports.ExecutionError = ExecutionError;
class ValidationError extends AppError {
    constructor(message) {
        super(message, 'VALIDATION_ERROR');
        Object.setPrototypeOf(this, ValidationError.prototype);
    }
}
exports.ValidationError = ValidationError;
