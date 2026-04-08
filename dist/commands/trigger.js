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
async function triggerCommand(agent, skillPath) {
    const evalsPath = path.resolve(process.cwd(), skillPath, 'evals', 'evals.json');
    if (!fs.existsSync(evalsPath)) {
        console.error(`[Error] Could not find evals.json at ${evalsPath}`);
        process.exit(1);
    }
    let evalsConfig;
    try {
        const raw = fs.readFileSync(evalsPath, 'utf-8');
        evalsConfig = JSON.parse(raw);
    }
    catch (err) {
        console.error(`[Error] Failed to parse evals.json:`, err);
        process.exit(1);
        throw err; // For TS flow
    }
    const { skill_name, evals } = evalsConfig;
    if (!skill_name || !Array.isArray(evals) || evals.length === 0) {
        console.error(`[Error] Invalid evals.json format. Expected 'skill_name' and a non-empty 'evals' array.`);
        process.exit(1);
    }
    console.log(`\nStarting evaluation for skill: ${skill_name}`);
    console.log(`Agent: ${agent}`);
    console.log(`Found ${evals.length} evals.\n`);
    // Setup Environment
    const env = new environment_1.EvalEnvironment({ skillPath });
    const evaluator = new evaluator_1.Evaluator(skill_name);
    let runner;
    try {
        runner = runners_1.RunnerFactory.create(agent);
    }
    catch (err) {
        console.error(`\n[Runner] ${err.message}`);
        process.exit(1);
        return; // For TS
    }
    await env.setup();
    // Setup Artifacts Directory
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const runDir = path.resolve(process.cwd(), '.project-skill-evals', 'runs', timestamp);
    fs.mkdirSync(runDir, { recursive: true });
    console.log(`[Artifacts] Saving to: ${runDir}\n`);
    let triggeredCount = 0;
    try {
        for (let i = 0; i < evals.length; i++) {
            const evalSpec = evals[i];
            const resultFileName = `eval_${i}_${evalSpec.id || 'unnamed'}.json`;
            const resultPath = path.join(runDir, resultFileName);
            process.stdout.write(`=> Processing eval ${i} [${evalSpec.id || 'unnamed'}]: "${evalSpec.prompt}"\n  ... `);
            // Run and determine parsing output
            const rawOutput = runner.runPrompt(evalSpec.prompt);
            let triggered = false;
            if (rawOutput) {
                triggered = evaluator.isSkillTriggered(rawOutput);
                // Persist the output
                fs.writeFileSync(resultPath, JSON.stringify(rawOutput, null, 2), 'utf-8');
            }
            else {
                // Runner returned null (process crash / JSON parse fail)
                fs.writeFileSync(resultPath, JSON.stringify({ error: "No JSON output was produced" }, null, 2), 'utf-8');
            }
            if (triggered) {
                triggeredCount++;
                console.log(`[Result: Triggered]`);
            }
            else {
                console.log(`[Result: Not Triggered]`);
            }
        }
        const percentage = Math.round((triggeredCount / evals.length) * 100);
        console.log(`\nResumen final: ${triggeredCount}/${evals.length}  ${percentage}%\n`);
    }
    finally {
        await env.teardown();
    }
}
