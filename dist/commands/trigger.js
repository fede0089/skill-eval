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
exports.triggerCommand = triggerCommand;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const environment_1 = require("../core/environment");
const runners_1 = require("../core/runners");
const evaluator_1 = require("../core/evaluator");
const logger_1 = require("../utils/logger");
const errors_1 = require("../core/errors");
async function triggerCommand(agent, skillPath) {
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
    logger_1.Logger.debug(`\nStarting evaluation for skill: ${skill_name}`);
    logger_1.Logger.debug(`Agent: ${agent}`);
    logger_1.Logger.debug(`Found ${evals.length} evals.\n`);
    // Setup Environment
    const env = new environment_1.EvalEnvironment({ skillPath });
    const evaluator = new evaluator_1.Evaluator(skill_name);
    const runner = runners_1.RunnerFactory.create(agent);
    await env.setup();
    // Setup Artifacts Directory
    const startTime = new Date();
    const timestamp = startTime.toISOString().replace(/[:.]/g, '-');
    const runDir = path.resolve(process.cwd(), '.project-skill-evals', 'runs', timestamp);
    fs.mkdirSync(runDir, { recursive: true });
    logger_1.Logger.debug(`[Artifacts] Saving to: ${runDir}\n`);
    const summaryResults = [];
    let triggeredCount = 0;
    try {
        for (let i = 0; i < evals.length; i++) {
            const evalSpec = evals[i];
            const resultFileName = `eval_${i}_${evalSpec.id || 'unnamed'}.json`;
            const resultPath = path.join(runDir, resultFileName);
            logger_1.Logger.write(`=> Processing eval ${i} [${evalSpec.id || 'unnamed'}]: "${evalSpec.prompt}"\n`);
            let worktreePath;
            let rawOutput = null;
            try {
                // Create isolated worktree for this evaluation
                worktreePath = env.createWorktree(`eval-${i}`);
                // Run agent strictly inside the worktree
                logger_1.Logger.write(`   Running agent... `);
                // Use a simple interval to show progress
                const interval = setInterval(() => {
                    logger_1.Logger.write('.');
                }, 2000);
                try {
                    rawOutput = runner.runPrompt(evalSpec.prompt, worktreePath);
                }
                finally {
                    clearInterval(interval);
                    logger_1.Logger.write(` Done.\n`);
                }
            }
            finally {
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
            }
            else {
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
                logger_1.Logger.info(`[Result: Triggered | ${latencyMs}ms | ${tokens} tokens]`);
            }
            else {
                let resultStatus = 'Not Triggered';
                if (rawOutput?.error) {
                    if (rawOutput.raw_output?.includes('Opening authentication page')) {
                        resultStatus = 'AUTH REQUIRED';
                    }
                    else {
                        resultStatus = 'ERROR';
                    }
                }
                logger_1.Logger.info(`[Result: ${resultStatus} | ${latencyMs}ms | ${tokens} tokens]`);
            }
        }
        const percentage = Math.round((triggeredCount / evals.length) * 100);
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
                passRate: `${percentage}%`,
                triggeredCount,
                totalCount: evals.length
            },
            results: summaryResults
        };
        fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf-8');
        logger_1.Logger.info(`\nResumen final:`);
        logger_1.Logger.info(`Success Rate: ${triggeredCount}/${evals.length} (${percentage}%)`);
        logger_1.Logger.info(`Avg Latency:  ${avgLatency}ms`);
        logger_1.Logger.info(`Total Tokens: ${totalTokens}\n`);
    }
    finally {
        await env.teardown();
    }
}
