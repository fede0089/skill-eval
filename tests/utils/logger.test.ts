import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { Logger } from '../../src/utils/logger.js';

describe('Logger', () => {
  it('Logger.success should print a message', (t) => {
    const logMock = mock.method(console, 'log', () => {});
    Logger.success('Success message');
    
    assert.strictEqual(logMock.mock.callCount(), 1);
    const call = logMock.mock.calls[0];
    // console.dir(call.arguments);
    const output = call.arguments.join(' ');
    assert.ok(output.includes('Success message'));
    logMock.mock.restore();
  });

  it('Logger.error should print a message', (t) => {
    const errorMock = mock.method(console, 'error', () => {});
    Logger.error('Error message');
    
    assert.strictEqual(errorMock.mock.callCount(), 1);
    const call = errorMock.mock.calls[0];
    const output = call.arguments.join(' ');
    assert.ok(output.includes('Error message'));
    errorMock.mock.restore();
  });

  it('Logger.table should print a formatted table', (t) => {
    const logMock = mock.method(console, 'log', () => {});
    const data = [
      ['Header 1', 'Header 2'],
      ['Value 1', 'Value 2']
    ];
    Logger.table(data);
    
    assert.strictEqual(logMock.mock.callCount(), 1);
    const call = logMock.mock.calls[0];
    assert.ok(call.arguments[0].includes('Value 1'));
    assert.ok(call.arguments[0].includes('Value 2'));
    logMock.mock.restore();
  });
});
