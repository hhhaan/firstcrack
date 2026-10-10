import type { PidRuntime } from '@entities/machine';
import { isPidEngaged } from './drop-cancel-control';

export const shouldSkipSidecarResetWhilePidEngaged = (pid: PidRuntime | null | undefined): boolean => isPidEngaged(pid);
