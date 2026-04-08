"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateCommand = rateCommand;
const logger_1 = require("../utils/logger");
const errors_1 = require("../core/errors");
async function rateCommand(score, options) {
    const rating = parseInt(score, 10);
    if (isNaN(rating) || rating < 1 || rating > 5) {
        throw new errors_1.ValidationError('Rating must be a number between 1 and 5.');
    }
    logger_1.Logger.info('\n==========================================');
    logger_1.Logger.info('       EXPERIENCE RATING VIEW           ');
    logger_1.Logger.info('==========================================');
    logger_1.Logger.info(`Rating: ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}`);
    if (options.comment) {
        logger_1.Logger.info(`Comment: ${options.comment}`);
    }
    logger_1.Logger.info('==========================================');
    logger_1.Logger.info('Thank you for your feedback!\n');
}
