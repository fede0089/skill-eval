import * as fs from 'fs';
import * as path from 'path';
import { EvalEnvironment } from '../core/environment';
import { RunnerFactory } from '../core/runners';
import { Evaluator } from '../core/evaluator';
import { EvalFile } from '../types';
import { Logger } from '../utils/logger';
import { ConfigError, ExecutionError } from '../core/errors';

export async function triggerCommand(agent: string, skillPath: string): Promise<void> {
  const evalsPath = path.resolve(process.cwd(), skillPath, 'evals', 'evals.json');

  if (!fs.existsSync(evalsPath)) {
    throw new ConfigError(`Could not find evals.json at ${evalsPath}`);
  }

  let evalsConfig: EvalFile;
  try {
    const raw = fs.readFileSync(evalsPath, 'utf-8');
    evalsConfig = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`Failed to parse evals.json: ${err instanceof Error ? err.message : String(err)}`);
  }

  const { skill_name, evals } = evalsConfig;
  if (!skill_name || !Array.isArray(evals) || evals.length === 0) {
    throw new ConfigError(`Invalid evals.json format. Expected 'skill_name' and a non-empty 'evals' array.`);
  }

  Logger.info(`\nStarting evaluation for skill: ${skill_name}`);
  Logger.info(`Agent: ${agent}`);
  Logger.info(`Found ${evals.length} evals.\n`);

  // Setup Environment
  const env = new EvalEnvironment({ skillPath });
  const evaluator = new Evaluator(skill_name);

  const runner = RunnerFactory.create(agent);

  await env.setup();

  // Setup Artifacts Directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(process.cwd(), '.project-skill-evals', 'runs', timestamp);
  fs.mkdirSync(runDir, { recursive: true });
  Logger.info(`[Artifacts] Saving to: ${runDir}\n`);

  let triggeredCount = 0;

  try {
    for (let i = 0; i < evals.length; i++) {
      const evalSpec = evals[i];
      const resultFileName = `eval_${i}_${evalSpec.id || 'unnamed'}.json`;
      const resultPath = path.join(runDir, resultFileName);

      Logger.write(`=> Processing eval ${i} [${evalSpec.id || 'unnamed'}]: "${evalSpec.prompt}"\n  ... `);

      // Run and determine parsing output
      const rawOutput = runner.runPrompt(evalSpec.prompt);

      let triggered = false;
      if (rawOutput) {
        triggered = evaluator.isSkillTriggered(rawOutput);
        // Persist the output
        fs.writeFileSync(resultPath, JSON.stringify(rawOutput, null, 2), 'utf-8');
      } else {
        // Runner returned null (process crash / JSON parse fail)
        fs.writeFileSync(resultPath, JSON.stringify({ error: "No JSON output was produced" }, null, 2), 'utf-8');
      }

      if (triggered) {
        triggeredCount++;
        Logger.info(`[Result: Triggered]`);
      } else {
        Logger.info(`[Result: Not Triggered]`);
      }
    }

    const percentage = Math.round((triggeredCount / evals.length) * 100);
    Logger.info(`\nResumen final: ${triggeredCount}/${evals.length}  ${percentage}%\n`);

  } finally {
    await env.teardown();
  }
}
