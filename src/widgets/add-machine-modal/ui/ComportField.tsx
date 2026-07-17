import type { SerialPort } from '@entities/machine';
import { useTranslation } from 'react-i18next';
import { inputCls } from '../lib/styles';

export const ComportField = ({
    value,
    onChange,
    ports,
    registryDefault,
}: {
    value: string;
    onChange: (v: string) => void;
    ports: SerialPort[];
    registryDefault: string;
}) => {
    const { t } = useTranslation();
    const listId = 'serial-port-options';
    const detectedDevices = ports.map((p) => p.device);
    const showRegistryDefault = registryDefault && !detectedDevices.includes(registryDefault);

    return (
        <div>
            <input
                className={inputCls}
                type="text"
                list={listId}
                placeholder={t('addMachine.selectPort')}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                autoComplete="off"
            />
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
