/**
 * 프로덕션 환경에서는 console 출력을 완전히 차단하는 로거 유틸.
 * Vite 빌드 시 `import.meta.env.DEV`는 정적으로 평가되어,
 * false인 경우 해당 코드가 tree-shaking으로 제거된다.
 */
export const logger = {
  error: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.error(...args);
  },
  warn: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.warn(...args);
  },
  log: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.log(...args);
  },
  info: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.info(...args);
  },
};