"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.viewCommand = viewCommand;
const logger_1 = require("../utils/logger");
async function viewCommand(options) {
    const ease = parseInt(options.ease || '0', 10);
    const speed = parseInt(options.speed || '0', 10);
    const accuracy = parseInt(options.accuracy || '0', 10);
    const drawStars = (score) => {
        const stars = '★'.repeat(score);
        const empty = '☆'.repeat(5 - score);
        return `[ ${stars}${empty} ]`;
    };
    logger_1.Logger.info('\n┌──────────────────────────────────────────┐');
    logger_1.Logger.info('│          NUEVA VISTA DE CALIFICACIÓN     │');
    logger_1.Logger.info('├──────────────────────────────────────────┤');
    logger_1.Logger.info(`│ Facilidad de uso:   ${drawStars(ease)}     │`);
    logger_1.Logger.info(`│ Velocidad:          ${drawStars(speed)}     │`);
    logger_1.Logger.info(`│ Precisión:          ${drawStars(accuracy)}     │`);
    logger_1.Logger.info('├──────────────────────────────────────────┤');
    if (options.comment) {
        logger_1.Logger.info(`│ Comentario:                              │`);
        // Basic wrapping for the comment
        const comment = options.comment.substring(0, 38);
        logger_1.Logger.info(`│ ${comment.padEnd(40)} │`);
    }
    logger_1.Logger.info('├──────────────────────────────────────────┤');
    logger_1.Logger.info('│ ¡Gracias por calificar tu experiencia!   │');
    logger_1.Logger.info('└──────────────────────────────────────────┘\n');
}
