import type { SerialPort } from '@entities/machine';
import { RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { inputCls } from '../lib/styles';

export const ComportField = ({
    value,
    onChange,
    ports,
    registryDefault,
    onRefresh,
}: {
    value: string;
    onChange: (v: string) => void;
    ports: SerialPort[];
    registryDefault: string;
    onRefresh?: () => void;
}) => {
    const { t } = useTranslation();
    const listId = 'serial-port-options';
    const detectedDevices = ports.map((p) => p.device);
    const showRegistryDefault = registryDefault && !detectedDevices.includes(registryDefault);

    return (
        <div className="flex items-center gap-2">
            <input
                className={inputCls}
                type="text"
                list={listId}
                placeholder={t('addMachine.selectPort')}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                autoComplete="off"
            />
            {onRefresh && (
                <button
                    type="button"
                    onClick={onRefresh}
                    aria-label={t('addMachine.refreshPorts')}
                    title={t('addMachine.refreshPorts')}
                    className="w-[34px] h-[34px] rounded-full border-none bg-surface dark:bg-surface-elevated text-muted dark:!text-[#8a8580] flex items-center justify-center cursor-pointer shrink-0 shadow-(--shadow-inset) transition-colors hover:text-primary dark:hover:!text-[#e5e5e5]"
                >
                    <RotateCw size={14} strokeWidth={2} />
                </button>
            )}
            <datalist id={listId}>
                {showRegistryDefault && <option value={registryDefault} />}
                {ports.map((p) => (
                    <option key={p.device} value={p.device}>
                        {p.description !== p.device ? p.description : undefined}
                    </option>
                ))}
            </datalist>
        </div>
    );
};
