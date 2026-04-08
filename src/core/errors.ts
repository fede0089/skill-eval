export class AppError extends Error {
  constructor(public message: string, public code: string = 'GENERIC_ERROR') {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class ConfigError extends AppError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    Object.setPrototypeOf(this, ConfigError.prototype);
  }
}

export class ExecutionError extends AppError {
  constructor(message: string) {
    super(message, 'EXECUTION_ERROR');
    Object.setPrototypeOf(this, ExecutionError.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}
