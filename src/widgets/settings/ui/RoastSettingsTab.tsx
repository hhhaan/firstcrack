import { BatchTitleNameSettings } from './BatchTitleNameSettings';
import { BatchTitleSettings } from './BatchTitleSettings';
import { CurveStyleSection } from './CurveStyleSection';
import { EventButtonSection } from './EventButtonSection';
import { ManualControlSection } from './ManualControlSection';
import { RoastingSettingsImport } from './RoastingSettingsImport';
import { AlertSettingsSection } from './roast-settings/AlertSettingsSection';
import { AutomationSettingsSections } from './roast-settings/AutomationSettingsSections';
import { AxisRangeSettingsSection, ControlChartSettingsSection } from './roast-settings/AxisRangeSettingsSections';
import { AxisTickSettingsSection } from './roast-settings/AxisTickSettingsSection';
import { DisplayStyleSections, DisplayVisibilitySections } from './roast-settings/DisplaySettingsSections';
import { PollingSection, TemperatureUnitSection } from './roast-settings/GeneralSettingsSections';
import { RorSpanSection, SmoothingControls } from './roast-settings/SensorSettingsSections';

export const RoastSettingsTab = () => (
    <div className="grid gap-8">
        <RoastingSettingsImport />
        <TemperatureUnitSection />
        <AlertSettingsSection />
        <AutomationSettingsSections />
        <EventButtonSection />
        <ManualControlSection />
        <DisplayVisibilitySections />
        <CurveStyleSection />
        <DisplayStyleSections />
        <AxisRangeSettingsSection />
        <AxisTickSettingsSection />
        <ControlChartSettingsSection />
        <SmoothingControls />
        <BatchTitleNameSettings />
        <BatchTitleSettings />
        <RorSpanSection />
        <PollingSection />
    </div>
);
