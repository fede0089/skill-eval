#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const trigger_1 = require("./commands/trigger");
const rate_1 = require("./commands/rate");
const view_1 = require("./commands/view");
const program = new commander_1.Command();
program
    .name('skill-eval')
    .description('CLI to evaluate agent skills triggering')
    .version('1.0.0');
program
    .command('trigger [agent]')
    .description('Evaluate triggering of an agent skill')
    .requiredOption('--skill <path>', 'Path to the skill directory')
    .action((agent, options) => {
    const selectedAgent = agent || 'gemini-cli';
    (0, trigger_1.triggerCommand)(selectedAgent, options.skill).catch((err) => {
        console.error(`Fatal error:`, err);
        process.exit(1);
    });
});
program
    .command('rate')
    .description('Rate your experience with the tool')
    .argument('<score>', 'Rating score from 1 to 5')
    .option('-c, --comment <text>', 'Optional comment')
    .action((score, options) => {
    (0, rate_1.rateCommand)(score, options).catch((err) => {
        console.error(`Fatal error:`, err);
        process.exit(1);
    });
});
program
    .command('view')
    .description('Comprehensive view to rate your experience')
    .option('-e, --ease <1-5>', 'Ease of use score (1-5)')
    .option('-s, --speed <1-5>', 'Speed and performance score (1-5)')
    .option('-a, --accuracy <1-5>', 'Triggering accuracy score (1-5)')
    .option('-c, --comment <text>', 'Overall comment')
    .action((options) => {
    (0, view_1.viewCommand)(options).catch((err) => {
        console.error(`Fatal error:`, err);
        process.exit(1);
    });
});
program.parse(process.argv);
