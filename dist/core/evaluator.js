"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Evaluator = void 0;
const logger_1 = require("../utils/logger");
class Evaluator {
    targetToolKeys;
    /**
     * Evaluator handles boolean verification of whether the skill activated or not.
     * `targetToolKeys` can be the skill_name directly, or specific tool names exposed by the skill.
     */
    constructor(skillName) {
        this.targetToolKeys = [
            skillName,
            skillName.replace(/-/g, '_')
        ];
    }
    isSkillTriggered(output) {
        if (!output?.stats?.tools?.byName) {
            return false;
        }
        const byName = output.stats.tools.byName;
        const toolNames = Object.keys(byName);
        const dispatchTools = ['activate_skill', 'generalist'];
        for (const tool of dispatchTools) {
            if (toolNames.includes(tool)) {
                const metrics = byName[tool];
                const calls = metrics.count ?? metrics.totalCalls ?? 0;
                if (calls > 0) {
                    return true;
                }
            }
        }
        for (const expectedKey of this.targetToolKeys) {
            const match = toolNames.find(t => t.includes(expectedKey) || expectedKey.includes(t));
            if (match) {
                const metrics = byName[match];
                const calls = metrics.count ?? metrics.totalCalls ?? 0;
                if (calls > 0) {
                    return true;
                }
            }
        }
        const totalCalls = output.stats.tools.totalCalls;
        if (totalCalls > 0) {
            logger_1.Logger.debug(`Tools were called (${toolNames.join(', ')}), but no explicit skill dispatch was detected.`);
        }
        return false;
    }
}
exports.Evaluator = Evaluator;
