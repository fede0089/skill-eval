"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.functionalCommand = functionalCommand;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const environment_1 = require("../core/environment");
const runners_1 = require("../core/runners");
const evaluator_1 = require("../core/evaluator");
const logger_1 = require("../utils/logger");
const errors_1 = require("../core/errors");
async function functionalCommand(agent, skillPath) {
    const evalsPath = path.resolve(process.cwd(), skillPath, 'evals', 'evals.json');
    if (!fs.existsSync(evalsPath)) {
        throw new errors_1.ConfigError(`Could not find evals.json at ${evalsPath}`);
    }
    let evalsConfig;
    try {
        const raw = fs.readFileSync(evalsPath, 'utf-8');
        evalsConfig = JSON.parse(raw);
    }
    catch (err) {
        throw new errors_1.ConfigError(`Failed to parse evals.json: ${err instanceof Error ? err.message : String(err)}`);
    }
    const { skill_name, evals } = evalsConfig;
    if (!skill_name || !Array.isArray(evals) || evals.length === 0) {
        throw new errors_1.ConfigError(`Invalid evals.json format. Expected 'skill_name' and a non-empty 'evals' array.`);
    }
    logger_1.Logger.debug(`\nStarting functional evaluation for skill: ${skill_name}`);
    logger_1.Logger.debug(`Agent: ${agent}`);
    logger_1.Logger.debug(`Found ${evals.length} evals.\n`);
    const env = new environment_1.EvalEnvironment({ skillPath });
    const evaluator = new evaluator_1.FunctionalEvaluator(skill_name);
    const runner = runners_1.RunnerFactory.create(agent);
    await env.setup();
    const startTime = new Date();
    const timestamp = startTime.toISOString().replace(/[:.]/g, '-');
    const runDir = path.resolve(process.cwd(), '.project-skill-evals', 'runs', timestamp);
    fs.mkdirSync(runDir, { recursive: true });
    logger_1.Logger.debug(`[Artifacts] Saving to: ${runDir}\n`);
    const summaryResults = [];
    let triggeredCount = 0;
    let functionalPassCount = 0;
    let passedExpectationsCount = 0;
    const totalExpectationsCount = evals.reduce((acc, e) => acc + (e.expectations?.length || 0), 0);
    try {
        for (let i = 0; i < evals.length; i++) {
            const evalSpec = evals[i];
            const resultFileName = `eval_${i}_${evalSpec.id || 'unnamed'}.json`;
            const resultPath = path.join(runDir, resultFileName);
            logger_1.Logger.write(`=> Eval ${i + 1}/${evals.length} [${evalSpec.id || 'unnamed'}]: "${evalSpec.prompt}"\n`);
            let worktreePath;
            let rawOutput = null;
            const logFileName = `eval_${i}_${evalSpec.id || 'unnamed'}_gemini.log`;
            const logPath = path.join(runDir, logFileName);
            try {
                // Create isolated worktree for this evaluation
                worktreePath = env.createWorktree(`eval-${i}`);
                // 1. Run target skill strictly inside the worktree
                const spinner = new logger_1.Spinner('Running agent');
                spinner.start();
                try {
                    rawOutput = await runner.runPrompt(evalSpec.prompt, worktreePath, (log) => {
                        if (spinner)
                            spinner.updateLog(log);
                    }, logPath);
                }
                finally {
                    spinner.stop();
                }
            }
            finally {
                // We'll cleanup worktree later to capture diff
            }
            let triggered = false;
            let response = '';
            let expectationsResults = [];
            let allPassed = true;
            if (rawOutput && !rawOutput.error) {
                triggered = evaluator.isSkillTriggered(rawOutput);
                response = rawOutput.response || '';
                // 2. Capture Workspace Context (Rich Diff)
                let context = 'No changes detected or git not available.';
                try {
                    if (worktreePath) {
                        const diff = (0, child_process_1.execSync)('git diff HEAD', { encoding: 'utf-8', cwd: worktreePath });
                        const untracked = (0, child_process_1.execSync)('git ls-files --others --exclude-standard', { encoding: 'utf-8', cwd: worktreePath });
                        if (diff || untracked) {
                            context = `[DIFF]\n${diff}\n\n[UNTRACKED FILES]\n${untracked}`;
                        }
                        else {
                            context = 'No changes detected (clean workspace).';
                        }
                    }
                }
                catch (e) {
                    // Git might not be available or error running diff
                }
                // 3. Evaluate Expectations if any
                if (evalSpec.expectations && evalSpec.expectations.length > 0) {
                    logger_1.Logger.debug(`   Evaluating ${evalSpec.expectations.length} expectations...`);
                    expectationsResults = await evaluator.evaluateFunctional(evalSpec.prompt, rawOutput, evalSpec.expectations, context);
                    allPassed = expectationsResults.every(r => r.passed);
                    passedExpectationsCount += expectationsResults.filter(r => r.passed).length;
                }
                else {
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
            }
            else {
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
            if (triggered)
                triggeredCount++;
            const hasExpectations = evalSpec.expectations && evalSpec.expectations.length > 0;
            if (triggered && allPassed && hasExpectations)
                functionalPassCount++;
            // Detailed logging for this eval
            const triggerEmoji = triggered ? '✅' : '❌';
            let resultStatus = '';
            if (triggered) {
                resultStatus = hasExpectations ? (allPassed ? 'PASSED' : 'FAILED EXPECTATIONS') : 'NO EXPECTATIONS';
            }
            else {
                // Check for specific error reasons in response if runner returned error
                if (response.includes('Opening authentication page')) {
                    resultStatus = 'AUTH REQUIRED';
                }
                else if (response.includes('Error:')) {
                    resultStatus = 'ERROR';
                }
                else {
                    resultStatus = 'NOT TRIGGERED';
                }
            }
            logger_1.Logger.info(`   Trigger: ${triggerEmoji}`);
            if (hasExpectations) {
                const passedCount = expectationsResults.filter(r => r.passed).length;
                const totalCount = expectationsResults.length;
                const statusEmoji = (allPassed && triggered) ? '✅' : '❌';
                logger_1.Logger.info(`   Expectations (${passedCount}/${totalCount} Passed) ${statusEmoji}:`);
                for (const exp of expectationsResults) {
                    const expEmoji = exp.passed ? '✅' : '❌';
                    const reason = exp.passed ? '' : ` -> (Reason: ${exp.reason})`;
                    logger_1.Logger.info(`      ${expEmoji} "${exp.expectation}"${reason}`);
                }
            }
            else if (!triggered) {
                logger_1.Logger.info(`   Result: ${resultStatus}`);
            }
            else {
                logger_1.Logger.info(`   Result: NO EXPECTATIONS`);
            }
            logger_1.Logger.write('\n');
        }
        const triggerPercentage = Math.round((triggeredCount / evals.length) * 100);
        const totalWithExpectations = evals.filter(e => e.expectations && e.expectations.length > 0).length;
        const functionalPercentage = totalWithExpectations > 0
            ? Math.round((functionalPassCount / totalWithExpectations) * 100)
            : 0;
        const expectationsMetPercentage = totalExpectationsCount > 0
            ? Math.round((passedExpectationsCount / totalExpectationsCount) * 100)
            : 0;
        const report = {
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
        logger_1.Logger.info(`Resumen final:`);
        logger_1.Logger.info(`--------------------------------------------------`);
        logger_1.Logger.info(`Functional Rate:   ${functionalPassCount} / ${totalWithExpectations} Evals (${functionalPercentage}%)`);
        logger_1.Logger.info(`Expectations Met:  ${passedExpectationsCount} / ${totalExpectationsCount} Total (${expectationsMetPercentage}%)`);
        logger_1.Logger.write('\n');
    }
    finally {
        await env.teardown();
    }
}
