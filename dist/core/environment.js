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
class EvalEnvironment {
    skillPath;
    absoluteSkillPath;
    constructor(options) {
        this.skillPath = options.skillPath;
        this.absoluteSkillPath = path.resolve(process.cwd(), this.skillPath);
    }
    async setup() {
        console.log(`\n[Environment] Linking skill from: ${this.absoluteSkillPath}`);
        try {
            // Link the target skill and auto-confirm the prompt
            (0, child_process_1.execSync)(`echo "Y" | gemini skills link "${this.absoluteSkillPath}"`, { stdio: 'inherit' });
            console.log(`[Environment] Skill linked successfully.\n`);
        }
        catch (error) {
            console.error(`[Error] Failed to link skill: ${error}`);
            throw error;
        }
    }
    async teardown() {
        const skillName = path.basename(this.absoluteSkillPath);
        console.log(`\n[Environment] Tearing down skill link for '${skillName}'...`);
        try {
            (0, child_process_1.execSync)(`gemini skills uninstall ${skillName}`, { stdio: 'inherit' });
            console.log(`[Environment] Teardown complete.\n`);
        }
        catch (error) {
            console.error(`\n[Warning] Failed to uninstall skill during teardown (it might already be uninstalled): ${error}`);
        }
    }
}
exports.EvalEnvironment = EvalEnvironment;
