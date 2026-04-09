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
exports.EvalEnvironment = void 0;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const logger_1 = require("../utils/logger");
const errors_1 = require("./errors");
class EvalEnvironment {
    skillPath;
    absoluteSkillPath;
    constructor(options) {
        this.skillPath = options.skillPath;
        this.absoluteSkillPath = path.resolve(process.cwd(), this.skillPath);
    }
    async setup() {
        logger_1.Logger.debug(`Linking skill from: ${this.absoluteSkillPath}`);
        // Link the target skill and auto-confirm the prompt
        const child = (0, child_process_1.spawnSync)('gemini', ['skills', 'link', this.absoluteSkillPath], {
            input: 'Y\n',
            stdio: ['pipe', 'ignore', 'ignore'],
            encoding: 'utf-8'
        });
        if (child.status !== 0) {
            const errorMsg = `Failed to link skill: gemini process exited with code ${child.status}`;
            logger_1.Logger.error(errorMsg);
            throw new errors_1.ExecutionError(errorMsg);
        }
        logger_1.Logger.debug(`Skill linked successfully.`);
    }
    async teardown() {
        const skillName = path.basename(this.absoluteSkillPath);
        logger_1.Logger.debug(`Tearing down skill link for '${skillName}'...`);
        const child = (0, child_process_1.spawnSync)('gemini', ['skills', 'uninstall', skillName], {
            stdio: 'ignore',
            encoding: 'utf-8'
        });
        if (child.status !== 0) {
            logger_1.Logger.debug(`Failed to uninstall skill during teardown (it might already be uninstalled). Status code: ${child.status}`);
        }
        else {
            logger_1.Logger.debug(`Teardown complete.`);
        }
    }
    /**
     * Creates a temporary git worktree for a specific evaluation.
     * This provides isolation by ensuring each test runs in its own clean copy of the repo.
     */
    createWorktree(evalId) {
        const worktreePath = path.resolve(process.cwd(), '.project-skill-evals', 'worktrees', evalId);
        logger_1.Logger.debug(`Creating worktree at: ${worktreePath}`);
        // Ensure the path is clean before adding a worktree
        // We try to remove it first in case a previous run crashed
        (0, child_process_1.spawnSync)('git', ['worktree', 'remove', '--force', worktreePath], { stdio: 'ignore' });
        const child = (0, child_process_1.spawnSync)('git', ['worktree', 'add', worktreePath, '-f'], {
            stdio: 'ignore',
            encoding: 'utf-8'
        });
        if (child.status !== 0) {
            throw new errors_1.ExecutionError(`Failed to create git worktree at ${worktreePath}. Process exited with code ${child.status}`);
        }
        return worktreePath;
    }
    /**
     * Removes a previously created git worktree.
     */
    removeWorktree(worktreePath) {
        logger_1.Logger.debug(`Removing worktree: ${worktreePath}`);
        const child = (0, child_process_1.spawnSync)('git', ['worktree', 'remove', '--force', worktreePath], {
            stdio: 'ignore',
            encoding: 'utf-8'
        });
        if (child.status !== 0) {
            logger_1.Logger.debug(`Failed to remove worktree at ${worktreePath}. Process exited with code ${child.status}`);
        }
    }
}
exports.EvalEnvironment = EvalEnvironment;
