import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { EvalEnvironment } from '../core/environment';
import { RunnerFactory } from '../core/runners';
import { FunctionalEvaluator } from '../core/evaluator';
import { FunctionalEvalResult, EvalSummaryReport, ExpectationResult, AgentOutput, Eval } from '../types';
import { Logger, Spinner } from '../utils/logger';
import { ConfigError } from '../core/errors';
import { loadEvals } from '../utils/eval-loader';

export async function functionalCommand(
  agent: string, 
  skillPath: string
): Promise<void> {
  const evalsConfig = loadEvals(skillPath);

  const { skill_name, evals } = evalsConfig;

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
  let functionalPassCount = 0;
  let passedExpectationsCount = 0;
  let baselinePassCount = 0;
  let baselinePassedExpectationsCount = 0;
  const totalExpectationsCount = evals.reduce((acc, e) => acc + (e.expectations?.length || 0), 0);

  async function runSingleEval(evalSpec: Eval, index: number, isBaseline: boolean): Promise<{
    response: string;
    allPassed: boolean;
    expectationsResults: ExpectationResult[];
  }> {
    const passName = isBaseline ? 'baseline' : 'functional';
    const promptToUse = isBaseline 
      ? evalSpec.prompt 
      : `${evalSpec.prompt}\n\nIMPORTANT: You must use the '${skill_name}' skill/tool to solve this task.`;

    const resultFileName = `eval_${index}_${evalSpec.id || 'unnamed'}_${passName}.json`;
    const resultPath = path.join(runDir, resultFileName);



    let worktreePath: string | undefined;
    let rawOutput: AgentOutput | null = null;
    const logFileName = `eval_${index}_${evalSpec.id || 'unnamed'}_${passName}_gemini.log`;
    const logPath = path.join(runDir, logFileName);

    try {
      worktreePath = env.createWorktree(`eval-${index}-${passName}`);
      if (!isBaseline) {
        await env.linkSkill(worktreePath);
      }

      const spinner = new Spinner(`Running Eval ${index + 1}/${evals.length}...`);
      spinner.start();
      try {
        rawOutput = await runner.runPrompt(promptToUse, worktreePath, (log) => {
          if (spinner) spinner.updateLog(log);
        }, logPath);
      } finally {
        spinner.stopAndClear();
      }
    } finally { }

    let response = '';
    let expectationsResults: ExpectationResult[] = [];
    let allPassed = false;

    if (rawOutput && !rawOutput.error) {
      response = rawOutput.response || '';
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
      } catch (e) { }

      if (evalSpec.expectations && evalSpec.expectations.length > 0) {
        const evalSpinner = new Spinner(`Evaluating expectations ${index + 1}/${evals.length}...`);
        evalSpinner.start();
        const judgeLogFileName = `eval_${index}_${evalSpec.id || 'unnamed'}_${passName}_judge_gemini.log`;
        const judgeLogPath = path.join(runDir, judgeLogFileName);
        try {
          expectationsResults = await evaluator.evaluateFunctional(
            evalSpec.prompt,
            rawOutput,
            evalSpec.expectations,
            context,
            (log) => {
              if (evalSpinner) evalSpinner.updateLog(log);
            },
            judgeLogPath
          );
        } finally {
          evalSpinner.stopAndClear();
        }
        allPassed = expectationsResults.every(r => r.passed);
      } else {
        allPassed = false;
      }

      const augmentedOutput = {
        ...rawOutput,
        [passName + '_eval']: {
          expectations: expectationsResults,
          all_passed: allPassed,
          workspace_context: context
        }
      };
      fs.writeFileSync(resultPath, JSON.stringify(augmentedOutput, null, 2), 'utf-8');
    } else {
      response = rawOutput?.error || 'Error: No JSON output was produced';
      fs.writeFileSync(resultPath, JSON.stringify({ error: response, raw_output: rawOutput?.raw_output }, null, 2), 'utf-8');
      allPassed = false;
      if (evalSpec.expectations) {
        expectationsResults = evalSpec.expectations.map(e => ({
          expectation: e,
          passed: false,
          reason: 'Agent execution failed'
        }));
      }
    }

    if (worktreePath) {
      env.removeWorktree(worktreePath);
    }

    let hasExpectations = false;
    if (evalSpec.expectations && evalSpec.expectations.length > 0) {
      hasExpectations = true;
      const passedCount = expectationsResults.filter(r => r.passed).length;
      const totalCount = expectationsResults.length;
      const statusEmoji = allPassed ? '✅' : '❌';
      Logger.write(`${statusEmoji} [${index + 1}/${evals.length}] "${evalSpec.prompt}"\n`);
      for (const exp of expectationsResults) {
        if (exp.passed) {
          Logger.write(`      ${chalk.green('✓')} ${chalk.gray(`"${exp.expectation}"`)}\n`);
        } else {
          Logger.write(`      ${chalk.red('✗')} ${chalk.gray(`"${exp.expectation}"`)}\n`);
          Logger.write(`        ↳ ${chalk.gray(`Reason: ${exp.reason}`)}\n`);
        }
      }
    } else {
      let resultStatus = '';
      if (response.includes('Opening authentication page')) {
        resultStatus = 'AUTH REQUIRED';
      } else if (response.includes('Error:')) {
        resultStatus = 'ERROR';
      } else {
        resultStatus = 'NO EXPECTATIONS';
      }
      Logger.write(`❌ [${index + 1}/${evals.length}] "${evalSpec.prompt}"\n`);
      Logger.write(`      ↳ ${chalk.gray(`Result: ${resultStatus}`)}\n`);
    }
    Logger.write('\n');

    return { response, allPassed, expectationsResults };
  }

  try {
    Logger.write(`\n${chalk.bold(`FUNCTIONAL EVALUATION: ${skillPath}`)}\n`);
    // ==== PASS 1: BASELINE ====
    Logger.write(`\n--- Baseline Pass (No Skill) ---\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);
    const baselineResultsMap = new Map();
    for (let i = 0; i < evals.length; i++) {
        const res = await runSingleEval(evals[i], i, true);
        baselineResultsMap.set(i, res);
        
        const evalSpec = evals[i];
        if (evalSpec.expectations && evalSpec.expectations.length > 0) {
          if (res.allPassed) baselinePassCount++;
          baselinePassedExpectationsCount += res.expectationsResults.filter((r) => r.passed).length;
        }
    }

    // ==== PASS 2: FUNCTIONAL (Skill Linked) ====
    Logger.write(`\n--- w/Skill Pass ---\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);
    
    for (let i = 0; i < evals.length; i++) {
        const evalSpec = evals[i];
        const res = await runSingleEval(evals[i], i, false);
        
        const baselineRes = baselineResultsMap.get(i);
        summaryResults.push({
            id: evalSpec.id || `eval-${i}`,
            prompt: evalSpec.prompt,
            response: res.response,
            expectationsResults: res.expectationsResults,
            allExpectationsPassed: res.allPassed,
            baselineAllExpectationsPassed: baselineRes?.allPassed,
            baselineExpectationsResults: baselineRes?.expectationsResults
        });

        const hasExpectations = evalSpec.expectations && evalSpec.expectations.length > 0;
        if (hasExpectations) {
            if (res.allPassed) functionalPassCount++;
            passedExpectationsCount += res.expectationsResults.filter((r) => r.passed).length;
        }
    }

    // ==== REPORTING ====
    const totalWithExpectations = evals.filter(e => e.expectations && e.expectations.length > 0).length;

    const functionalPercentage = totalWithExpectations > 0 
      ? Math.round((functionalPassCount / totalWithExpectations) * 100)
      : 0;
    const expectationsMetPercentage = totalExpectationsCount > 0
      ? Math.round((passedExpectationsCount / totalExpectationsCount) * 100)
      : 0;
      
    const baselinePercentage = totalWithExpectations > 0
      ? Math.round((baselinePassCount / totalWithExpectations) * 100)
      : 0;

    const skillUplift = functionalPercentage - baselinePercentage;

    const report: EvalSummaryReport = {
      timestamp: startTime.toISOString(),
      skill_name,
      agent,
      metrics: {
        passRate: `${functionalPercentage}%`,
        passedCount: functionalPassCount,
        totalCount: totalWithExpectations,
        totalExpectations: totalExpectationsCount,
        passedExpectations: passedExpectationsCount,
        expectationsPassRate: `${expectationsMetPercentage}%`,
        baselinePassedCount: baselinePassCount,
        baselinePassRate: `${baselinePercentage}%`,
        skillUplift: `${skillUplift > 0 ? '+' : ''}${skillUplift}%`
      },
      results: summaryResults
    };

    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf-8');

    const baselineRateLine = `   Baseline Success Rate:   ${baselinePercentage}%  (${baselinePassCount}/${totalWithExpectations})`;
    const funcRateLine     = `   w/Skill Success Rate:    ${functionalPercentage}% (${functionalPassCount}/${totalWithExpectations})`;

    Logger.write(`\nEVALUATION SUMMARY\n`);
    Logger.write(`──────────────────────────────────────────────────\n`);
    Logger.write(`${baselineRateLine}\n`);
    Logger.write(`${funcRateLine}\n`);
    Logger.write('\n');

  } finally {
    await env.teardown();
  }
}
