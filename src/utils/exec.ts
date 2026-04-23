import { execSync, ExecSyncOptions, spawnSync, SpawnSyncOptions, SpawnSyncReturns } from 'child_process';

export const executor = {
  execSync(command: string, options?: ExecSyncOptions): Buffer | string {
    return execSync(command, options);
  },
  spawnSync(command: string, args: string[], options?: SpawnSyncOptions): SpawnSyncReturns<Buffer | string> {
    return spawnSync(command, args, options);
  }
};
