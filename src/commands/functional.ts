import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { EvalEnvironment } from '../core/environment';
import { RunnerFactory } from '../core/runners';
import { FunctionalEvaluator } from '../core/evaluator';
import { EvalFile, FunctionalEvalResult, EvalSummaryReport, ExpectationResult } from '../types';
import { Logger } from '../utils/logger';
import { ConfigError } from '../core/errors';

export async function functionalCommand(agent: string, skillPath: string): Promise<void> {
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

  Logger.info(`\nStarting functional evaluation for skill: ${skill_name}`);
  Logger.info(`Agent: ${agent}`);
  Logger.info(`Found ${evals.length} evals.\n`);

  const env = new EvalEnvironment({ skillPath });
  const evaluator = new FunctionalEvaluator(skill_name);
  const runner = RunnerFactory.create(agent);

  await env.setup();

  const startTime = new Date();
  const timestamp = startTime.toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(process.cwd(), '.project-skill-evals', 'runs', timestamp);
  fs.mkdirSync(runDir, { recursive: true });
  Logger.info(`[Artifacts] Saving to: ${runDir}\n`);

  const summaryResults: FunctionalEvalResult[] = [];
  let triggeredCount = 0;
  let functionalPassCount = 0;

  try {
    for (let i = 0; i < evals.length; i++) {
      const evalSpec = evals[i];
      const resultFileName = `eval_${i}_${evalSpec.id || 'unnamed'}.json`;
      const resultPath = path.join(runDir, resultFileName);

      Logger.write(`=> Processing eval ${i} [${evalSpec.id || 'unnamed'}]: "${evalSpec.prompt}"\n  ... `);

      // 1. Run target skill
      const rawOutput = runner.runPrompt(evalSpec.prompt);

      let triggered = false;
      let latencyMs = 0;
      let tokens = 0;
      let response = '';
      let expectationsResults: ExpectationResult[] = [];
      let allPassed = true;

      if (rawOutput) {
        triggered = evaluator.isSkillTriggered(rawOutput);
        const metrics = evaluator.extractMetrics(rawOutput);
        latencyMs = metrics.latencyMs;
        tokens = metrics.tokens;
        response = rawOutput.response || '';

        // 2. Capture Workspace Context (Simplified)
        let context = 'No changes detected or git not available.';
        try {
          context = execSync('git status --porcelain', { encoding: 'utf-8' });
          if (!context) context = 'No changes detected (clean workspace).';
        } catch (e) {
          // Git might not be available or not a repo
        }

        // 3. Evaluate Expectations if any
        if (evalSpec.expectations && evalSpec.expectations.length > 0) {
          Logger.write(`Evaluating ${evalSpec.expectations.length} expectations... `);
          expectationsResults = await evaluator.evaluateFunctional(
            evalSpec.prompt,
            rawOutput,
            evalSpec.expectations,
            context
          );
          allPassed = expectationsResults.every(r => r.passed);
        }

        // Persist the output (augmented with expectations)
        const augmentedOutput = {
          ...rawOutput,
          functional_eval: {
            expectations: expectationsResults,
            all_passed: allPassed,
            workspace_context: context
          }
        };
        fs.writeFileSync(resultPath, JSON.stringify(augmentedOutput, null, 2), 'utf-8');
      } else {
        response = 'Error: No JSON output was produced';
        fs.writeFileSync(resultPath, JSON.stringify({ error: response }, null, 2), 'utf-8');
      }

      summaryResults.push({
        id: evalSpec.id || `eval-${i}`,
        prompt: evalSpec.prompt,
        triggered,
        latencyMs,
        tokens,
        response,
        expectationsResults,
        allExpectationsPassed: allPassed
      });

      if (triggered) triggeredCount++;
      if (triggered && allPassed) functionalPassCount++;

      const resultStatus = triggered ? (allPassed ? 'PASSED' : 'FAILED EXPECTATIONS') : 'NOT TRIGGERED';
      Logger.info(`[Result: ${resultStatus} | ${latencyMs}ms | ${tokens} tokens]`);
    }

    const triggerPercentage = Math.round((triggeredCount / evals.length) * 100);
    const functionalPercentage = triggeredCount > 0 
      ? Math.round((functionalPassCount / triggeredCount) * 100)
      : 0;
    const totalTokens = summaryResults.reduce((acc, r) => acc + r.tokens, 0);
    const avgLatency = summaryResults.length > 0 
      ? Math.round(summaryResults.reduce((acc, r) => acc + r.latencyMs, 0) / summaryResults.length)
      : 0;

    const report: EvalSummaryReport & { functional_metrics: any } = {
      timestamp: startTime.toISOString(),
      skill_name,
      agent,
      metrics: {
        avgLatencyMs: avgLatency,
        totalTokens: totalTokens,
        passRate: `${triggerPercentage}%`,
        triggeredCount,
        totalCount: evals.length
      },
      functional_metrics: {
        passRate: `${functionalPercentage}%`,
        passedCount: functionalPassCount,
        totalTriggered: triggeredCount
      },
      results: summaryResults
    };

    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf-8');

    Logger.info(`\nResumen final:`);
    Logger.info(`Trigger Rate:    ${triggeredCount}/${evals.length} (${triggerPercentage}%)`);
    Logger.info(`Functional Rate: ${functionalPassCount}/${triggeredCount} (${functionalPercentage}%)`);
    Logger.info(`Avg Latency:     ${avgLatency}ms`);
    Logger.info(`Total Tokens:    ${totalTokens}\n`);

  } finally {
    await env.teardown();
  }
}
