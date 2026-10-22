import { cn } from '@shared/lib/cn';
import { Loader, Wifi, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { primaryConnectBtnCls, secondaryBtnCls } from '../lib/styles';
import type { CommitAction, SuccessActions, TestState } from '../model/types';

type Props = {
    isEdit: boolean;
    testState: TestState;
    testMessage: string;
    canCommit: boolean;
    saving: boolean;
    successActions: SuccessActions;
    onTest: () => void;
    onClose: () => void;
    onCommit: (action: CommitAction) => void;
};

export const ConfirmStepFooter = ({
    isEdit,
    testState,
    testMessage,
    canCommit,
    saving,
    successActions,
    onTest,
    onClose,
    onCommit,
}: Props) => {
    const { t } = useTranslation();

    return (
        <div className="shrink-0 border-t border-border-subtle bg-main-bg">
            {/* Confirm step: connection test status */}
            {testState !== 'idle' && (
                <div
                    className={cn(
                        'px-7 py-2.5 flex items-center gap-2 text-[13px] border-b border-black/4 dark:border-border',
                        testState === 'success' &&
                            'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10',
                        testState === 'failed' && 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10',
                        testState === 'testing' && 'text-secondary',
                    )}
                >
                    {testState === 'testing' && <Loader size={14} className="animate-spin dark:!text-[#a3a3a3]" />}
                    {testState === 'success' && <Wifi size={14} className="dark:!text-green-400" />}
                    {testState === 'failed' && <WifiOff size={14} className="dark:!text-red-400" />}
                    <span>{testState === 'testing' ? t('addMachine.testingConnection') : testMessage}</span>
                    {testState === 'success' && (
                        <span className="text-[11px] text-green-600 dark:!text-green-400 opacity-70 ml-1">(live)</span>
                    )}
                </div>
            )}

            {/* Confirm step: actions */}
            <div className="flex flex-wrap justify-between items-center gap-2.5 px-6 py-4">
                <button
                    type="button"
                    onClick={onTest}
                    disabled={!canCommit || testState === 'testing'}
                    className={cn(
                        secondaryBtnCls,
                        'flex items-center gap-1.5',
                        (!canCommit || testState === 'testing') && 'text-muted cursor-default',
                        testState === 'testing' && 'opacity-60',
                    )}
                >
                    <Wifi size={14} strokeWidth={2} />
                    {t('addMachine.testConnection')}
                </button>

                <div className="flex flex-wrap gap-2.5 items-center">
                    <button type="button" onClick={onClose} className={secondaryBtnCls}>
                        {t('common.cancel')}
                    </button>

                    {testState === 'success' ? (
                        <>
                            <button
                                type="button"
                                onClick={() => onCommit(successActions.secondary.action)}
                                disabled={saving}
                                className={cn(secondaryBtnCls, saving && 'opacity-70 cursor-default')}
                            >
                                {successActions.secondary.label}
                            </button>
                            <button
                                type="button"
                                onClick={() => onCommit(successActions.primary.action)}
                                disabled={saving}
                                className={cn(
                                    primaryConnectBtnCls,
                                    saving ? 'opacity-70 cursor-default' : 'cursor-pointer',
                                )}
                            >
                                <Wifi size={14} strokeWidth={2.5} />
                                {saving ? successActions.primary.loading : successActions.primary.label}
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            onClick={() => onCommit(isEdit ? 'save' : 'add')}
                            disabled={!canCommit || saving}
                            className={cn(
                                'px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-opacity',
                                !canCommit
                                    ? 'border-none bg-surface dark:bg-surface-elevated text-muted cursor-default shadow-(--shadow-inset)'
                                    : 'border border-transparent bg-action text-on-action cursor-pointer shadow-(--shadow-card)',
                                saving && 'opacity-70',
                            )}
                        >
                            {saving
                                ? isEdit
                                    ? t('addMachine.saving')
                                    : t('addMachine.adding')
                                : isEdit
                                  ? t('addMachine.save')
                                  : t('machines.addMachine')}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
