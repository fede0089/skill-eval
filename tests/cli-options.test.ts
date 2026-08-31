import { test } from 'node:test';
import * as assert from 'node:assert';
import { program } from '../src/index.js';

// Importing the entrypoint only registers the commands: it parses argv exclusively
// when run as the CLI binary, so the declarations can be inspected here directly.

function commandNamed(name: string) {
  const command = program.commands.find(c => c.name() === name);
  assert.ok(command, `Expected a '${name}' command to be registered`);
  return command;
}

function optionNamed(commandName: string, flag: string) {
  const option = commandNamed(commandName).options.find(o => o.long === flag);
  assert.ok(option, `Expected '${commandName}' to declare ${flag}`);
  return option;
}

for (const commandName of ['trigger', 'functional']) {
  test(`${commandName}: --trials defaults to five`, () => {
    assert.strictEqual(optionNamed(commandName, '--trials').defaultValue, '5');
  });

  test(`${commandName}: --output is declared and has no default of its own`, () => {
    // The fallback lives in resolveOutputDir, which needs the skill name to build
    // ~/.skill-eval/<skill>; a commander default here would shadow it.
    const option = optionNamed(commandName, '--output');
    assert.strictEqual(option.defaultValue, undefined);
    assert.ok(option.required, 'Expected --output to take a path argument');
  });
}
