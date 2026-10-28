import { feedbackValue } from '@shared/lib/feedback';
import { formatTsvRows, TSV_HEADER } from '@shared/lib/tsv-writer';
import type { BbpPoint } from './bbp-types';

export const bbpPointsToTsv = (points: BbpPoint[], chargeOffsetSec?: number): string =>
    TSV_HEADER +
    (chargeOffsetSec == null ? '' : `# bbp_charge_offset_sec\t${chargeOffsetSec}\n`) +
    formatTsvRows(
        points,
        (p) =>
            `${chargeOffsetSec == null ? p.t.toFixed(1) : String(p.t)}\t${p.bt}\t${p.et ?? ''}\t\t${feedbackValue(p.heater, 'heater', p.processing?.read_units) ?? ''}\t${feedbackValue(p.fan, 'fan', p.processing?.read_units) ?? ''}\t${feedbackValue(p.drum, 'drum', p.processing?.read_units) ?? ''}\t\t${p.etRaw ?? ''}\t${p.btRaw ?? ''}\t${p.ror_et ?? ''}\t${p.sensorTimestamp ?? ''}\t${p.sensorClock ?? ''}\t${p.extraReadings === undefined ? '' : JSON.stringify(p.extraReadings)}\n`,
    );
