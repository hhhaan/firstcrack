import type { NetworkHost } from '@entities/machine';
import { inputCls } from '@shared/ui/form-styles';
import { Loader2, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const HostField = ({
    id,
    value,
    onChange,
    hosts,
    placeholder,
    scanning,
    onScan,
    scannedOnce,
}: {
    id?: string;
    value: string;
    onChange: (v: string) => void;
    hosts: NetworkHost[];
    placeholder?: string;
    scanning: boolean;
    onScan?: () => void;
    scannedOnce: boolean;
}) => {
    const { t } = useTranslation();
    const listId = 'network-host-options';

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
                <input
                    id={id}
                    className={inputCls}
                    type="text"
                    list={listId}
                    placeholder={placeholder ?? ''}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    autoComplete="off"
                />
                {onScan && (
                    <button
                        type="button"
                        onClick={onScan}
                        disabled={scanning}
                        aria-label={scanning ? t('addMachine.scanning') : t('addMachine.scanNetwork')}
                        title={scanning ? t('addMachine.scanning') : t('addMachine.scanNetwork')}
                        className="w-[34px] h-[34px] rounded-full border-none bg-surface dark:bg-surface-elevated text-muted dark:!text-[#8a8580] flex items-center justify-center cursor-pointer shrink-0 shadow-(--shadow-inset) transition-colors hover:text-primary dark:hover:!text-[#e5e5e5] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {scanning ? (
                            <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                        ) : (
                            <Search size={14} strokeWidth={2} />
                        )}
                    </button>
                )}
                <datalist id={listId}>
                    {hosts.map((h) => (
                        <option key={h.host} value={h.host} />
                    ))}
                </datalist>
            </div>
            {scannedOnce && !scanning && hosts.length === 0 && (
                <p className="text-[11px] text-muted m-0 leading-relaxed">{t('addMachine.scanEmpty')}</p>
            )}
        </div>
    );
};
