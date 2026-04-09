import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { EvalEnvironment } from '../core/environment';
import { RunnerFactory } from '../core/runners';
import { FunctionalEvaluator } from '../core/evaluator';
import { EvalFile, FunctionalEvalResult, EvalSummaryReport, ExpectationResult, AgentOutput } from '../types';
import { Logger, Spinner } from '../utils/logger';
import { ConfigError } from '../core/errors';

export async function functionalCommand(
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

  Logger.debug(`\nStarting functional evaluation for skill: ${skill_name}`);
  Logger.debug(`Agent: ${agent}`);
  Logger.debug(`Found ${evals.length} evals.\n`);

  const env = new EvalEnvironment({ skillPath });
  const evaluator = new FunctionalEvaluator(skill_name);
  const runner = RunnerFactory.create(agent);

  await env.setup();

  const startTime = new Date();
  const timestamp = startTime.toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(process.cwd(), '.project-skill-evals', 'runs', timestamp);
  fs.mkdirSync(runDir, { recursive: true });
  Logger.debug(`[Artifacts] Saving to: ${runDir}\n`);

  const summaryResults: FunctionalEvalResult[] = [];
  let triggeredCount = 0;
  let functionalPassCount = 0;
  let passedExpectationsCount = 0;
  const totalExpectationsCount = evals.reduce((acc, e) => acc + (e.expectations?.length || 0), 0);

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

        // 1. Run target skill strictly inside the worktree
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
        // We'll cleanup worktree later to capture diff
      }

      let triggered = false;
      let response = '';
      let expectationsResults: ExpectationResult[] = [];
      let allPassed = true;

      if (rawOutput && !rawOutput.error) {
        triggered = evaluator.isSkillTriggered(rawOutput);
        response = rawOutput.response || '';

        // 2. Capture Workspace Context (Rich Diff)
        let context = 'No changes detected or git not available.';
        try {
          if (worktreePath) {
            const diff = execSync('git diff HEAD', { encoding: 'utf-8', cwd: worktreePath });
            const untracked = execSync('git ls-files --others --exclude-standard', { encoding: 'utf-8', cwd: worktreePath });
            
            if (diff || untracked) {
              context = `[DIFF]\n${diff}\n\n[UNTRACKED FILES]\n${untracked}`;
            } else {
              context = 'No changes detected (clean workspace).';
            }
          }
        } catch (e) {
          // Git might not be available or error running diff
        }

        // 3. Evaluate Expectations if any
        if (evalSpec.expectations && evalSpec.expectations.length > 0) {
          Logger.debug(`   Evaluating ${evalSpec.expectations.length} expectations...`);
          expectationsResults = await evaluator.evaluateFunctional(
            evalSpec.prompt,
            rawOutput,
            evalSpec.expectations,
            context
          );
          allPassed = expectationsResults.every(r => r.passed);
          passedExpectationsCount += expectationsResults.filter(r => r.passed).length;
        } else {
          allPassed = false; // No expectations = Not passed functionally
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
        response = rawOutput?.error || 'Error: No JSON output was produced';
        // Runner returned error (process crash / JSON parse fail / Auth required)
        fs.writeFileSync(resultPath, JSON.stringify({ error: response, raw_output: rawOutput?.raw_output }, null, 2), 'utf-8');
        allPassed = false;
        
        // Map missing expectations as failed
        if (evalSpec.expectations) {
          expectationsResults = evalSpec.expectations.map(e => ({
            expectation: e,
            passed: false,
            reason: triggered ? 'Failed to evaluate' : 'Agent did not trigger'
          }));
        }
      }

      // Cleanup worktree after diff capture and evaluation
      if (worktreePath) {
        env.removeWorktree(worktreePath);
      }

      summaryResults.push({
        id: evalSpec.id || `eval-${i}`,
        prompt: evalSpec.prompt,
        triggered,
        response,
        expectationsResults,
        allExpectationsPassed: allPassed
      });

      if (triggered) triggeredCount++;
      const hasExpectations = evalSpec.expectations && evalSpec.expectations.length > 0;
      if (triggered && allPassed && hasExpectations) functionalPassCount++;

      // Detailed logging for this eval
      const triggerEmoji = triggered ? '✅' : '❌';
      let resultStatus = '';
      if (triggered) {
        resultStatus = hasExpectations ? (allPassed ? 'PASSED' : 'FAILED EXPECTATIONS') : 'NO EXPECTATIONS';
      } else {
        // Check for specific error reasons in response if runner returned error
        if (response.includes('Opening authentication page')) {
          resultStatus = 'AUTH REQUIRED';
        } else if (response.includes('Error:')) {
          resultStatus = 'ERROR';
        } else {
          resultStatus = 'NOT TRIGGERED';
        }
      }

      Logger.info(`   Trigger: ${triggerEmoji}`);
      if (hasExpectations) {
        const passedCount = expectationsResults.filter(r => r.passed).length;
        const totalCount = expectationsResults.length;
        const statusEmoji = (allPassed && triggered) ? '✅' : '❌';
        Logger.info(`   Expectations (${passedCount}/${totalCount} Passed) ${statusEmoji}:`);
        for (const exp of expectationsResults) {
          const expEmoji = exp.passed ? '✅' : '❌';
          const reason = exp.passed ? '' : ` -> (Reason: ${exp.reason})`;
          Logger.info(`      ${expEmoji} "${exp.expectation}"${reason}`);
        }
      } else if (!triggered) {
        Logger.info(`   Result: ${resultStatus}`);
      } else {
        Logger.info(`   Result: NO EXPECTATIONS`);
      }
      Logger.write('\n');
    }

    const triggerPercentage = Math.round((triggeredCount / evals.length) * 100);
    const totalWithExpectations = evals.filter(e => e.expectations && e.expectations.length > 0).length;

    const functionalPercentage = totalWithExpectations > 0 
      ? Math.round((functionalPassCount / totalWithExpectations) * 100)
      : 0;
    const expectationsMetPercentage = totalExpectationsCount > 0
      ? Math.round((passedExpectationsCount / totalExpectationsCount) * 100)
      : 0;

    const report: EvalSummaryReport & { functional_metrics: any } = {
      timestamp: startTime.toISOString(),
      skill_name,
      agent,
      metrics: {
        passRate: `${triggerPercentage}%`,
        triggeredCount,
        totalCount: evals.length
      },
      functional_metrics: {
        passRate: `${functionalPercentage}%`,
        passedCount: functionalPassCount,
        totalTriggered: triggeredCount,
        totalWithExpectations,
        totalExpectations: totalExpectationsCount,
        passedExpectations: passedExpectationsCount,
        expectationsPassRate: `${expectationsMetPercentage}%`
      },
      results: summaryResults
    };

    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf-8');

    Logger.info(`Resumen final:`);
    Logger.info(`--------------------------------------------------`);
    Logger.info(`Functional Rate:   ${functionalPassCount} / ${totalWithExpectations} Evals (${functionalPercentage}%)`);
    Logger.info(`Expectations Met:  ${passedExpectationsCount} / ${totalExpectationsCount} Total (${expectationsMetPercentage}%)`);
    Logger.write('\n');

  } finally {
    await env.teardown();
  }
}
