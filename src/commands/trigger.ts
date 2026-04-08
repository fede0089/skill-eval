import * as fs from 'fs';
import * as path from 'path';
import { EvalEnvironment } from '../core/environment';
import { RunnerFactory } from '../core/runners';
import { Evaluator } from '../core/evaluator';
import { EvalFile, EvalSummaryReport, EvalSummaryResult } from '../types';
import { Logger } from '../utils/logger';
import { ConfigError } from '../core/errors';

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
  const startTime = new Date();
  const timestamp = startTime.toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(process.cwd(), '.project-skill-evals', 'runs', timestamp);
  fs.mkdirSync(runDir, { recursive: true });
  Logger.info(`[Artifacts] Saving to: ${runDir}\n`);

  const summaryResults: EvalSummaryResult[] = [];
  let triggeredCount = 0;

  try {
    for (let i = 0; i < evals.length; i++) {
      const evalSpec = evals[i];
      const resultFileName = `eval_${i}_${evalSpec.id || 'unnamed'}.json`;
      const resultPath = path.join(runDir, resultFileName);

      Logger.write(`=> Processing eval ${i} [${evalSpec.id || 'unnamed'}]: "${evalSpec.prompt}"\n  ... `);

      let worktreePath: string | undefined;
      let rawOutput: AgentOutput | null = null;

      try {
        // Create isolated worktree for this evaluation
        worktreePath = env.createWorktree(`eval-${i}`);

        // Run agent strictly inside the worktree
        rawOutput = runner.runPrompt(evalSpec.prompt, worktreePath);
      } finally {
        // Cleanup worktree immediately after run
        if (worktreePath) {
          env.removeWorktree(worktreePath);
        }
      }

      let triggered = false;
      let latencyMs = 0;
      let tokens = 0;
      let response = '';

      if (rawOutput && !rawOutput.error) {
        triggered = evaluator.isSkillTriggered(rawOutput);
        const metrics = evaluator.extractMetrics(rawOutput);
        latencyMs = metrics.latencyMs;
        tokens = metrics.tokens;
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
        latencyMs,
        tokens,
        response
      });

      if (triggered) {
        triggeredCount++;
        Logger.info(`[Result: Triggered | ${latencyMs}ms | ${tokens} tokens]`);
      } else {
        let resultStatus = 'Not Triggered';
        if (rawOutput?.error) {
          if (rawOutput.raw_output?.includes('Opening authentication page')) {
            resultStatus = 'AUTH REQUIRED';
          } else {
            resultStatus = 'ERROR';
          }
        }
        Logger.info(`[Result: ${resultStatus} | ${latencyMs}ms | ${tokens} tokens]`);
      }
    }

    const percentage = Math.round((triggeredCount / evals.length) * 100);
    const totalTokens = summaryResults.reduce((acc, r) => acc + r.tokens, 0);
    const avgLatency = summaryResults.length > 0 
      ? Math.round(summaryResults.reduce((acc, r) => acc + r.latencyMs, 0) / summaryResults.length)
      : 0;

    const report: EvalSummaryReport = {
      timestamp: startTime.toISOString(),
      skill_name,
      agent,
      metrics: {
        avgLatencyMs: avgLatency,
        totalTokens: totalTokens,
        passRate: `${percentage}%`,
        triggeredCount,
        totalCount: evals.length
      },
      results: summaryResults
    };

    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf-8');

    Logger.info(`\nResumen final:`);
    Logger.info(`Success Rate: ${triggeredCount}/${evals.length} (${percentage}%)`);
    Logger.info(`Avg Latency:  ${avgLatency}ms`);
    Logger.info(`Total Tokens: ${totalTokens}\n`);

  } finally {
    await env.teardown();
  }
}
