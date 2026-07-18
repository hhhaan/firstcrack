/**
 * 프로덕션 환경에서는 console 출력을 완전히 차단하는 로거 유틸.
 * Vite 빌드 시 `import.meta.env.DEV`는 정적으로 평가되어,
 * false인 경우 해당 코드가 tree-shaking으로 제거된다.
 *
 * logger.capture는 PROD에서 Sentry로 전송되며, DEV에서 console.error로 출력된다.
 */
import * as Sentry from '@sentry/react';

export const logger = {
    error: (...args: unknown[]) => {
        if (import.meta.env.DEV) console.error(...args);
    },
    capture: (error: unknown, context?: Record<string, unknown>) => {
        if (import.meta.env.DEV) console.error(error);
        if (import.meta.env.PROD) Sentry.captureException(error, { extra: context });
    },
    debug: (...args: unknown[]) => {
        // biome-ignore lint/suspicious/noConsole: logger wraps console
        if (import.meta.env.DEV) console.debug(...args);
    },
    warn: (...args: unknown[]) => {
        if (import.meta.env.DEV) console.warn(...args);
    },
    log: (...args: unknown[]) => {
        // biome-ignore lint/suspicious/noConsole: logger wraps console
        if (import.meta.env.DEV) console.log(...args);
    },
    info: (...args: unknown[]) => {
        // biome-ignore lint/suspicious/noConsole: logger wraps console
        if (import.meta.env.DEV) console.info(...args);
    },
};
