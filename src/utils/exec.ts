import { execSync, ExecSyncOptions, spawnSync, SpawnSyncOptions, SpawnSyncReturns } from 'child_process';

export const executor = {
  execSync(command: string, options?: any): any {
    return execSync(command, options);
  },
  spawnSync(command: string, args: string[], options?: any): any {
    return spawnSync(command, args, options);
  }
};
