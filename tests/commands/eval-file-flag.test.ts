import { test } from 'node:test';
import * as assert from 'node:assert';
import { program } from '../../src/index.js';

for (const command of ['trigger', 'functional']) {
  test(`${command} command should have --eval-file flag`, () => {
    const cmd = program.commands.find(c => c.name() === command);
    assert.ok(cmd, `${command} command not found`);

    const option = cmd.options.find(o => o.long === '--eval-file');
    assert.ok(option, `--eval-file option not found on ${command} command`);
  });
}
