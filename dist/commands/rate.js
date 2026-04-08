"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateCommand = rateCommand;
async function rateCommand(score, options) {
    const rating = parseInt(score, 10);
    if (isNaN(rating) || rating < 1 || rating > 5) {
        console.error('[Error] Rating must be a number between 1 and 5.');
        process.exit(1);
    }
    console.log('\n==========================================');
    console.log('       EXPERIENCE RATING VIEW           ');
    console.log('==========================================');
    console.log(`Rating: ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}`);
    if (options.comment) {
        console.log(`Comment: ${options.comment}`);
    }
    console.log('==========================================');
    console.log('Thank you for your feedback!\n');
}
