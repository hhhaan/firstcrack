import { useRoastingStore } from '@features/active-roast/model/status';
import { logger } from '@shared/lib/logger';
import { flushTsv } from '@shared/lib/tsv-writer';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ask } from '@tauri-apps/plugin-dialog';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

/** The close guard must survive a roast screen render failure. */
export const useRoastCloseGuard = () => {
    const { t } = useTranslation();
    const tRef = useRef(t);
    useEffect(() => {
        tRef.current = t;
    }, [t]);
    // ── Effect: 로스팅 중 / ended 미저장 창 닫기 확인 (#177) ──────
    useEffect(() => {
        if (!('__TAURI_INTERNALS__' in window)) return;
        const win = getCurrentWindow();
        let unlisten: (() => void) | undefined;
        let active = true;
        let prompting = false;
        void win
            .onCloseRequested(async (e) => {
                const { phase, awaitingNextCharge } = useRoastingStore.getState();
                // A second close must wait for the prompt and every pending TSV write.
                if (prompting) {
                    e.preventDefault();
                    return;
                }
                prompting = true;
                try {
                    if (phase === 'roasting' || phase === 'ended' || awaitingNextCharge) {
                        const translate = tRef.current;
                        const ok = await ask(translate('activeRoast.dialogs.unsavedCloseMsg'), {
                            title: translate('activeRoast.dialogs.unsavedCloseTitle'),
                            kind: 'warning',
                            okLabel: translate('activeRoast.dialogs.closeWithoutSaving'),
                            cancelLabel: translate('activeRoast.dialogs.keepUsing'),
                        });
                        if (!ok) {
                            e.preventDefault();
                            return;
                        }
                    }
                    try {
                        await flushTsv();
                    } catch (err) {
                        logger.capture(err, { scope: 'activeRoast.flushOnClose' });
                        // flush failure must not block window close
                    }
                    // 확인이면 preventDefault 하지 않는다. Tauri 2는 JS 리스너가 있으면
                    // 네이티브 close를 이미 취소하고, preventDefault가 없을 때만 destroy() 한다.
                    // close()+unlisten()은 리스너만 지워서 이후 빨간 버튼/Cmd+W가 무시된다.
                } catch (err) {
                    e.preventDefault();
                    logger.capture(err, { scope: 'activeRoast.closePrompt' });
                } finally {
                    prompting = false;
                }
            })
            .then((fn) => {
                if (active) {
                    unlisten = fn;
                } else {
                    fn();
                }
            })
            .catch((err: unknown) => {
                logger.capture(err, { scope: 'activeRoast.closeListen' });
            });
        return () => {
            active = false;
            unlisten?.();
        };
    }, []);
};
