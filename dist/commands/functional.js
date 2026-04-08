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
    logger_1.Logger.info(`\nStarting functional evaluation for skill: ${skill_name}`);
    logger_1.Logger.info(`Agent: ${agent}`);
    logger_1.Logger.info(`Found ${evals.length} evals.\n`);
    const env = new environment_1.EvalEnvironment({ skillPath });
    const evaluator = new evaluator_1.FunctionalEvaluator(skill_name);
    const runner = runners_1.RunnerFactory.create(agent);
    await env.setup();
    const startTime = new Date();
    const timestamp = startTime.toISOString().replace(/[:.]/g, '-');
    const runDir = path.resolve(process.cwd(), '.project-skill-evals', 'runs', timestamp);
    fs.mkdirSync(runDir, { recursive: true });
    logger_1.Logger.info(`[Artifacts] Saving to: ${runDir}\n`);
    const summaryResults = [];
    let triggeredCount = 0;
    let functionalPassCount = 0;
    try {
        for (let i = 0; i < evals.length; i++) {
            const evalSpec = evals[i];
            const resultFileName = `eval_${i}_${evalSpec.id || 'unnamed'}.json`;
            const resultPath = path.join(runDir, resultFileName);
            logger_1.Logger.write(`=> Processing eval ${i} [${evalSpec.id || 'unnamed'}]: "${evalSpec.prompt}"\n  ... `);
            // 1. Run target skill
            const rawOutput = runner.runPrompt(evalSpec.prompt);
            let triggered = false;
            let latencyMs = 0;
            let tokens = 0;
            let response = '';
            let expectationsResults = [];
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
                    context = (0, child_process_1.execSync)('git status --porcelain', { encoding: 'utf-8' });
                    if (!context)
                        context = 'No changes detected (clean workspace).';
                }
                catch (e) {
                    // Git might not be available or not a repo
                }
                // 3. Evaluate Expectations if any
                if (evalSpec.expectations && evalSpec.expectations.length > 0) {
                    logger_1.Logger.write(`Evaluating ${evalSpec.expectations.length} expectations... `);
                    expectationsResults = await evaluator.evaluateFunctional(evalSpec.prompt, rawOutput, evalSpec.expectations, context);
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
            }
            else {
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
            if (triggered)
                triggeredCount++;
            if (triggered && allPassed)
                functionalPassCount++;
            const resultStatus = triggered ? (allPassed ? 'PASSED' : 'FAILED EXPECTATIONS') : 'NOT TRIGGERED';
            logger_1.Logger.info(`[Result: ${resultStatus} | ${latencyMs}ms | ${tokens} tokens]`);
        }
        const triggerPercentage = Math.round((triggeredCount / evals.length) * 100);
        const functionalPercentage = triggeredCount > 0
            ? Math.round((functionalPassCount / triggeredCount) * 100)
            : 0;
        const totalTokens = summaryResults.reduce((acc, r) => acc + r.tokens, 0);
        const avgLatency = summaryResults.length > 0
            ? Math.round(summaryResults.reduce((acc, r) => acc + r.latencyMs, 0) / summaryResults.length)
            : 0;
        const report = {
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
        logger_1.Logger.info(`\nResumen final:`);
        logger_1.Logger.info(`Trigger Rate:    ${triggeredCount}/${evals.length} (${triggerPercentage}%)`);
        logger_1.Logger.info(`Functional Rate: ${functionalPassCount}/${triggeredCount} (${functionalPercentage}%)`);
        logger_1.Logger.info(`Avg Latency:     ${avgLatency}ms`);
        logger_1.Logger.info(`Total Tokens:    ${totalTokens}\n`);
    }
    finally {
        await env.teardown();
    }
}
