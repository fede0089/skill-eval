import { test } from 'node:test';
import * as assert from 'node:assert';
import { program } from '../src/index.js';
import { DEFAULT_AGENT } from '../src/runners/registry.js';

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

for (const commandName of ['trigger', 'functional']) {
  test(`${commandName}: names the executor agent by flag, defaulting to the registry default`, () => {
    const option = optionNamed(commandName, '--executor-agent');
    assert.strictEqual(option.defaultValue, DEFAULT_AGENT);
    assert.ok(option.required, 'Expected --executor-agent to take an agent name');
  });

  test(`${commandName}: takes no positional argument`, () => {
    // The positional agent is gone: one position cannot name two roles, so the
    // old form has to fail at the command line rather than pick a role for you.
    assert.strictEqual(commandNamed(commandName).registeredArguments.length, 0);
  });
}

test('functional: names the judge agent by flag, with no default of its own', () => {
  // The fallback lives in the action handler, which resolves it to the executor;
  // a commander default here would freeze the judge on the registry default even
  // when the author moved the executor elsewhere.
  const option = optionNamed('functional', '--judge-agent');
  assert.strictEqual(option.defaultValue, undefined);
  assert.ok(option.required, 'Expected --judge-agent to take an agent name');
});

test('trigger: declares no judge agent, because it grades programmatically', () => {
  const declared = commandNamed('trigger').options.map(o => o.long);
  assert.ok(!declared.includes('--judge-agent'), `trigger should not offer a judge it never invokes, got: ${declared.join(' ')}`);
});
