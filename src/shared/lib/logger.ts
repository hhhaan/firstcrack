/**
 * 프로덕션 환경에서는 console 출력을 완전히 차단하는 로거 유틸.
 * Vite 빌드 시 `import.meta.env.DEV`는 정적으로 평가되어,
 * false인 경우 해당 코드가 tree-shaking으로 제거된다.
 *
 * logger.error/capture는 DEV에서 console.error로 출력하고 Sentry로도 보낸다, 전송 정책(활성 여부·조치 가능성·스크러빙)은
 * 전부 shared/lib/sentry에 위임한다.
 */
import { captureActionable } from '@shared/lib/sentry';

export const logger = {
    error: (...args: unknown[]) => {
        if (import.meta.env.DEV) console.error(...args);
        // Error 인스턴스가 없으면 문자열 메시지로 보낸다 — 여기서 new Error로 감싸면 스택이 전부
        // logger.ts가 되어 Sentry가 한 이슈로 뭉친다.
        captureActionable(args.find((arg) => arg instanceof Error) ?? args.map(String).join(' '));
    },
    capture: (error: unknown, context?: Record<string, unknown>) => {
        if (import.meta.env.DEV) console.error(error);
        captureActionable(error, context);
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
