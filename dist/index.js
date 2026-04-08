#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const trigger_1 = require("./commands/trigger");
const functional_1 = require("./commands/functional");
const logger_1 = require("./utils/logger");
const errors_1 = require("./core/errors");
const program = new commander_1.Command();
const errorHandler = (err) => {
    if (err instanceof errors_1.AppError) {
        logger_1.Logger.error(err.message);
    }
    else if (err instanceof Error) {
        logger_1.Logger.error(`An unexpected error occurred: ${err.message}`, err.stack);
    }
    else {
        logger_1.Logger.error(`An unknown error occurred: ${String(err)}`);
    }
    process.exit(1);
};
program
    .name('skill-eval')
    .description('CLI to evaluate agent skills triggering and functionality')
    .version('1.0.0');
program
    .command('trigger [agent]')
    .description('Evaluate triggering of an agent skill')
    .requiredOption('--skill <path>', 'Path to the skill directory')
    .action((agent, options) => {
    const selectedAgent = agent || 'gemini-cli';
    (0, trigger_1.triggerCommand)(selectedAgent, options.skill).catch(errorHandler);
});
program
    .command('functional [agent]')
    .description('Evaluate functional correctness of an agent skill based on expectations')
    .requiredOption('--skill <path>', 'Path to the skill directory')
    .action((agent, options) => {
    const selectedAgent = agent || 'gemini-cli';
    (0, functional_1.functionalCommand)(selectedAgent, options.skill).catch(errorHandler);
});
program.parse(process.argv);
