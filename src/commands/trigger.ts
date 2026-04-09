import * as fs from 'fs';
import * as path from 'path';
import { EvalEnvironment } from '../core/environment';
import { RunnerFactory } from '../core/runners';
import { Evaluator } from '../core/evaluator';
import { EvalFile, EvalSummaryReport, EvalSummaryResult, AgentOutput } from '../types';
import { Logger, Spinner } from '../utils/logger';
import { ConfigError } from '../core/errors';

export async function triggerCommand(
  agent: string, 
  skillPath: string
): Promise<void> {
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

  Logger.debug(`\nStarting evaluation for skill: ${skill_name}`);
  Logger.debug(`Agent: ${agent}`);
  Logger.debug(`Found ${evals.length} evals.\n`);

  // Setup Environment
  const env = new EvalEnvironment({ skillPath });
  const evaluator = new Evaluator(skill_name);

  const runner = RunnerFactory.create(agent);

  await env.setup();

  // Setup Artifacts Directory
  const startTime = new Date();
  const timestamp = startTime.toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(process.cwd(), '.project-skill-evals', 'runs', timestamp);
  fs.mkdirSync(runDir, { recursive: true });
  Logger.debug(`[Artifacts] Saving to: ${runDir}\n`);

  const summaryResults: EvalSummaryResult[] = [];
  let triggeredCount = 0;

  try {
    for (let i = 0; i < evals.length; i++) {
      const evalSpec = evals[i];
      const resultFileName = `eval_${i}_${evalSpec.id || 'unnamed'}.json`;
      const resultPath = path.join(runDir, resultFileName);

      Logger.write(`=> Eval ${i + 1}/${evals.length} [${evalSpec.id || 'unnamed'}]: "${evalSpec.prompt}"\n`);

      let worktreePath: string | undefined;
      let rawOutput: AgentOutput | null = null;
      const logFileName = `eval_${i}_${evalSpec.id || 'unnamed'}_gemini.log`;
      const logPath = path.join(runDir, logFileName);

      try {
        // Create isolated worktree for this evaluation
        worktreePath = env.createWorktree(`eval-${i}`);

        // Run agent strictly inside the worktree
        const spinner = new Spinner('Running agent');
        spinner.start();

        try {
          rawOutput = await runner.runPrompt(evalSpec.prompt, worktreePath, (log) => {
            if (spinner) spinner.updateLog(log);
          }, logPath);
        } finally {
          spinner.stop();
        }
      } finally {
        // Cleanup worktree immediately after run
        if (worktreePath) {
          env.removeWorktree(worktreePath);
        }
      }

      let triggered = false;
      let response = '';

      if (rawOutput && !rawOutput.error) {
        triggered = evaluator.isSkillTriggered(rawOutput);
        response = rawOutput.response || '';

        // Persist the output
        fs.writeFileSync(resultPath, JSON.stringify(rawOutput, null, 2), 'utf-8');
      } else {
        // Runner returned error (process crash / JSON parse fail / Auth required)
        response = rawOutput?.error || 'Error: No JSON output was produced';
        fs.writeFileSync(resultPath, JSON.stringify({ error: response, raw_output: rawOutput?.raw_output }, null, 2), 'utf-8');
      }

      summaryResults.push({
        id: evalSpec.id || `eval-${i}`,
        prompt: evalSpec.prompt,
        triggered,
        response
      });

      if (triggered) {
        triggeredCount++;
        Logger.info(`   Trigger: ✅`);
      } else {
        let resultStatus = 'NOT TRIGGERED';
        if (rawOutput?.error) {
          if (rawOutput.raw_output?.includes('Opening authentication page')) {
            resultStatus = 'AUTH REQUIRED';
          } else {
            resultStatus = 'ERROR';
          }
        }
        Logger.info(`   Trigger: ❌`);
        Logger.info(`   Result: ${resultStatus}`);
      }
      Logger.write('\n');
    }

    const percentage = Math.round((triggeredCount / evals.length) * 100);

    const report: EvalSummaryReport = {
      timestamp: startTime.toISOString(),
      skill_name,
      agent,
      metrics: {
        passRate: `${percentage}%`,
        triggeredCount,
        totalCount: evals.length
      },
      results: summaryResults
    };

    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf-8');

    Logger.info(`Resumen final:`);
    Logger.info(`--------------------------------------------------`);
    Logger.info(`Success Rate:      ${triggeredCount} / ${evals.length} Evals (${percentage}%)`);
    Logger.write('\n');

  } finally {
    await env.teardown();
  }
}
