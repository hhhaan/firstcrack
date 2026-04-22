import { useState, useEffect } from 'react';
import { Play, Pause, Square, Thermometer, Wind, TrendingUp, AlertCircle, Maximize2, Minimize2 } from 'lucide-react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import EndRoastModal from '../widgets/active-roast/end-roast-modal/ui/EndRoastModal';
import RoastSummaryModal, { type RoastSummaryData } from '../widgets/active-roast/roast-summary-modal/ui/RoastSummaryModal';

// Generate realistic roast temperature data
function generateFullRoastData() {
  const points = [];
  for (let t = 0; t <= 780; t += 15) {
    const min = t / 60;
    let bt: number;

    if (t <= 90) {
      bt = 200 - (48 * t / 90);
    } else if (t <= 180) {
      bt = 152 + (4 * (t - 90) / 90);
    } else if (t <= 420) {
      bt = 156 + (18 * (t - 180) / 240);
    } else if (t <= 660) {
      bt = 174 + (19 * (t - 420) / 240);
    } else {
      bt = 193 + (10 * (t - 660) / 120);
    }

    const et = t === 0 ? 220 : t <= 90 ? 220 - (5 * t / 90) : 215 + Math.sin(t / 300) * 0.8;

    let ror = 0;
    if (points.length > 0) {
      const prev = points[points.length - 1];
      ror = (bt - prev.bt) / (15 / 60);
      if (t <= 90) ror = 0;
    }

    points.push({
      time: t,
      label: `${Math.floor(min)}:${String(Math.round((min % 1) * 60)).padStart(2, '0')}`,
      bt: Math.round(bt * 10) / 10,
      et: Math.round(et * 10) / 10,
      ror: Math.max(0, Math.round(ror * 10) / 10),
    });
  }
  return points;
}

const fullData = generateFullRoastData();
const CURRENT_TIME = 480; // 8 minutes in (active roast in progress)
const INITIAL_LOG_ENTRIES = [
  { time: '0:00', event: 'Charge', temp: '200°C', note: 'Ethiopia Yirgacheffe 250g' },
  { time: '1:30', event: 'Turning Point', temp: '152°C', note: 'Thermal crash complete' },
  { time: '5:10', event: 'Yellow', temp: '166°C', note: 'Color change visible' },
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'white',
      border: 'none',
      borderRadius: 10,
      padding: '10px 14px',
      boxShadow: 'rgba(0,0,0,0.4) 0px 0px 1px, rgba(0,0,0,0.04) 0px 4px 4px',
      fontSize: 12,
      fontFamily: 'var(--font-body)',
    }}>
      <div style={{ fontWeight: 500, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.14px' }}>{label}</div>
      {payload.map((entry: any) => (
        <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: entry.color, flexShrink: 0 }} />
          <span style={{ color: 'var(--text-secondary)' }}>{entry.name}:</span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            {entry.name === 'ROR' ? `${entry.value}°/min` : `${entry.value}°C`}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function ActiveRoast() {
  const [elapsed, setElapsed] = useState(CURRENT_TIME);
  const [isRunning, setIsRunning] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [roastEnded, setRoastEnded] = useState(false);
  const [showEndRoastModal, setShowEndRoastModal] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [summaryData, setSummaryData] = useState<RoastSummaryData | null>(null);
  const [roastNotes, setRoastNotes] = useState('');
  const [pressedButtons, setPressedButtons] = useState<Set<string>>(new Set());
  const [logEntries, setLogEntries] = useState(INITIAL_LOG_ENTRIES);

  const toggleFullscreen = () => {
    setIsFullscreen(prev => !prev);
  };

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setElapsed(e => Math.min(e + 1, 780));
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  useEffect(() => {
    if (!showEndRoastModal) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowEndRoastModal(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showEndRoastModal]);

  const currentIndex = Math.floor(elapsed / 15);
  const currentPoint = fullData[Math.min(currentIndex, fullData.length - 1)];

  // Build merged chart data: actual values up to elapsed, target dashed beyond
  const chartData = fullData.map(p => ({
    label: p.label,
    btActual: p.time <= elapsed ? p.bt : null,
    btTarget: p.time > elapsed ? p.bt : null,
    etActual: p.time <= elapsed ? p.et : null,
    rorActual: p.time <= elapsed ? p.ror : null,
  }));

  const elapsedMin = Math.floor(elapsed / 60);
  const elapsedSec = elapsed % 60;
  const timeStr = `${elapsedMin}:${String(elapsedSec).padStart(2, '0')}`;

  const prevIndex = Math.max(0, currentIndex - 4);
  const rorNow = currentIndex > 4
    ? ((fullData[currentIndex].bt - fullData[prevIndex].bt) / (60 / 60)).toFixed(1)
    : '—';

  let phase = 'Drying';
  let phaseColor = '#d97706';
  if (elapsed > 630) { phase = 'Development'; phaseColor = '#ea580c'; }
  else if (elapsed > 300) { phase = 'Maillard'; phaseColor = '#b45309'; }
  else if (elapsed > 180) { phase = 'Yellowing'; phaseColor = '#ca8a04'; }

  const eventMarkerColor: Record<string, string> = {
    Yellow: '#ca8a04',
    'FC Start': '#ea580c',
    'FC End': '#dc2626',
    End: '#171717',
    Note: '#6b7280',
  };

  const eventMarkers = logEntries
    .filter(e => eventMarkerColor[e.event])
    .map(e => {
      const [min, sec] = e.time.split(':').map(Number);
      const totalSec = min * 60 + sec;
      const closest = fullData.reduce((prev, curr) =>
        Math.abs(curr.time - totalSec) < Math.abs(prev.time - totalSec) ? curr : prev
      );
      return { ...e, chartLabel: closest.label, color: eventMarkerColor[e.event] };
    });

  const flashButton = (label: string) => {
    setPressedButtons(prev => new Set(prev).add(label));
    setTimeout(() => setPressedButtons(prev => { const n = new Set(prev); n.delete(label); return n; }), 600);
  };

  const markEvent = (event: string, note: string, buttonLabel?: string) => {
    setLogEntries(prev => [...prev, { time: timeStr, event, temp: `${currentPoint?.bt}°C`, note }]);
    if (buttonLabel) flashButton(buttonLabel);
  };

  const handleMarkNote = () => {
    const note = window.prompt('Note:');
    if (note?.trim()) markEvent('Note', note.trim(), 'Add Log Note');
  };

  const resetActiveRoast = () => {
    setElapsed(CURRENT_TIME);
    setIsRunning(true);
    setRoastEnded(false);
    setLogEntries(INITIAL_LOG_ENTRIES);
    setPressedButtons(new Set());
  };

  const confirmEndRoast = () => {
    const completedLogEntries = [
      ...logEntries,
      { time: timeStr, event: 'End', temp: `${currentPoint?.bt}°C`, note: 'Roast complete' },
    ];

    setSummaryData({
      totalTime: timeStr,
      development: devTimeStr,
      finalBt: `${currentPoint?.bt}°C`,
      logEntries: completedLogEntries,
    });

    setShowEndRoastModal(false);
    setRoastNotes('');
    setShowSummaryModal(true);
    resetActiveRoast();
  };

  const handleEndRoastClick = () => {
    if (roastEnded) return;
    setShowEndRoastModal(true);
  };

  // Development time calculation
  const fcStartEntry = logEntries.find(e => e.event === 'FC Start');
  const devTimeStr = (() => {
    if (!fcStartEntry) return '—';
    const [m, s] = fcStartEntry.time.split(':').map(Number);
    const devSec = elapsed - (m * 60 + s);
    if (devSec <= 0) return '—';
    const pct = Math.round((devSec / elapsed) * 100);
    return `${Math.floor(devSec / 60)}:${String(devSec % 60).padStart(2, '0')} (${pct}%)`;
  })();

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1100, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: roastEnded ? '#6b7280' : '#22c55e',
              boxShadow: roastEnded ? 'none' : '0 0 0 3px rgba(34,197,94,0.2)',
              animation: roastEnded ? 'none' : 'pulse 2s infinite',
            }} />
            <span style={{ fontSize: 12, fontWeight: 500, color: roastEnded ? '#6b7280' : '#16a34a', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              {roastEnded ? 'Roast Complete' : 'Roast in Progress'}
            </span>
          </div>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 300,
            fontSize: 32,
            lineHeight: 1.13,
            color: 'var(--text-primary)',
            letterSpacing: '-0.4px',
            marginBottom: 4,
          }}>
            Ethiopia Yirgacheffe
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', letterSpacing: '0.14px' }}>
            Natural · Guji Zone · Profile: Signature Light
          </p>
        </div>



        {/* Timer */}
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 44,
            fontWeight: 600,
            color: 'var(--text-primary)',
            letterSpacing: '-2px',
            lineHeight: 1,
            marginBottom: 4,
          }}>
            {timeStr}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', letterSpacing: '0.14px' }}>
            {phase} phase
          </div>
        </div>
      </div>

      {/* Live readings */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Bean Temp', value: `${currentPoint?.bt ?? '—'}°C`, icon: Thermometer, color: '#ea580c', bg: 'rgba(253,224,178,0.5)' },
          { label: 'Env Temp', value: `${currentPoint?.et ?? '—'}°C`, icon: Wind, color: '#2563eb', bg: 'rgba(219,234,254,0.5)' },
          { label: 'Rate of Rise', value: `${rorNow}°/min`, icon: TrendingUp, color: '#7c3aed', bg: 'rgba(237,233,254,0.5)' },
          { label: 'Phase', value: phase, icon: AlertCircle, color: phaseColor, bg: `rgba(253,224,178,0.3)` },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} style={{
            background: 'var(--bg)',
            borderRadius: 14,
            padding: '16px 18px',
            boxShadow: 'var(--shadow-ring)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                background: bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <Icon size={14} strokeWidth={2} color={color} />
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                {label}
              </span>
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 22,
              fontWeight: 600,
              color: 'var(--text-primary)',
              letterSpacing: '-0.5px',
            }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Temperature Chart */}
      <div
        style={{
          background: 'var(--bg)',
          borderRadius: isFullscreen ? 0 : 16,
          padding: isFullscreen ? '40px 60px' : '24px 24px 16px',
          boxShadow: isFullscreen ? 'none' : 'var(--shadow-ring)',
          marginBottom: 20,
          display: 'flex',
          flexDirection: 'column',
          height: isFullscreen ? '100vh' : 'auto',
          width: isFullscreen ? '100vw' : 'auto',
          position: isFullscreen ? 'fixed' : 'relative',
          top: 0,
          left: 0,
          zIndex: isFullscreen ? 9999 : 1,
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h2 style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '0.15px' }}>
              Temperature Curve
            </h2>
            {/* Inline Fullscreen Button in Chart Header */}
            <button
              onClick={toggleFullscreen}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 8,
                border: 'none',
                background: isFullscreen ? 'var(--bg-secondary)' : 'var(--text-primary)',
                color: isFullscreen ? 'var(--text-primary)' : 'var(--bg)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: isFullscreen ? 'var(--shadow-inset)' : 'none',
              }}
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            {[
              { color: '#171717', label: 'Bean Temp (BT)' },
              { color: '#2563eb', label: 'Env Temp (ET)', dashed: true },
              { color: '#d97706', label: 'Rate of Rise (ROR)', bar: true },
            ].map(({ color, label, dashed, bar }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {bar ? (
                  <div style={{ width: 12, height: 8, borderRadius: 2, background: color, opacity: 0.6 }} />
                ) : (
                  <div style={{
                    width: 16,
                    height: 2,
                    background: color,
                    borderRadius: 1,
                    opacity: dashed ? 0.5 : 1,
                    backgroundImage: dashed ? `repeating-linear-gradient(to right, ${color} 0, ${color} 4px, transparent 4px, transparent 7px)` : 'none',
                  }} />
                )}
                <span style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.14px' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Fullscreen Content Layout */}
        <div style={{
          display: 'flex',
          flexDirection: isFullscreen ? 'row' : 'column',
          gap: 24,
          flex: 1,
          minHeight: 0,
        }}>
          {/* Main Chart Area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {/* Phase labels */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {[
                { label: 'Drying', range: '0:00–3:00', active: elapsed < 180 },
                { label: 'Yellowing', range: '3:00–5:00', active: elapsed >= 180 && elapsed < 300 },
                { label: 'Maillard', range: '5:00–10:30', active: elapsed >= 300 && elapsed < 630 },
                { label: 'Development', range: '10:30→', active: elapsed >= 630 },
              ].map(({ label, range, active }) => (
                <div key={label} style={{
                  padding: '4px 10px',
                  borderRadius: 9999,
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: '0.3px',
                  background: active ? 'var(--text-primary)' : 'var(--bg-secondary)',
                  color: active ? 'white' : 'var(--text-muted)',
                  boxShadow: active ? 'none' : 'var(--shadow-inset)',
                  transition: 'all 0.3s',
                }}>
                  {label} <span style={{ opacity: 0.6 }}>{range}</span>
                </div>
              ))}
            </div>

            <ResponsiveContainer width="100%" height={isFullscreen ? '100%' : 260}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="0" stroke="rgba(0,0,0,0.05)" />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  interval={isFullscreen ? 2 : 3}
                  tick={{ fontSize: 11, fontFamily: 'var(--font-mono)', fill: 'var(--text-muted)' }}
                />
                <YAxis
                  yAxisId="temp"
                  domain={[140, 230]}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fontFamily: 'var(--font-mono)', fill: 'var(--text-muted)' }}
                  width={36}
                  tickFormatter={v => `${v}°`}
                />
                <YAxis
                  yAxisId="ror"
                  orientation="right"
                  domain={[0, 20]}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fontFamily: 'var(--font-mono)', fill: 'var(--text-muted)' }}
                  width={36}
                  tickFormatter={v => `${v}°/m`}
                />
                <Tooltip content={<CustomTooltip />} />

                {/* Phase markers */}
                <ReferenceLine yAxisId="temp" x="3:00" stroke="rgba(0,0,0,0.07)" strokeDasharray="3 3" />
                <ReferenceLine yAxisId="temp" x="5:00" stroke="rgba(0,0,0,0.07)" strokeDasharray="3 3" />
                <ReferenceLine yAxisId="temp" x="10:30" stroke="rgba(0,0,0,0.07)" strokeDasharray="3 3" />

                {/* Current time marker */}
                <ReferenceLine
                  yAxisId="temp"
                  x={currentPoint?.label}
                  stroke="rgba(0,0,0,0.3)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />

                {/* Profile target (dashed) */}
                <Line
                  yAxisId="temp"
                  dataKey="btTarget"
                  stroke="var(--text-primary)"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  dot={false}
                  opacity={0.25}
                  name="Target BT"
                  connectNulls={false}
                />

                {/* Actual BT (solid) */}
                <Line
                  yAxisId="temp"
                  dataKey="btActual"
                  stroke="var(--text-primary)"
                  strokeWidth={2.5}
                  dot={false}
                  name="Bean Temp"
                  connectNulls={false}
                  activeDot={{ r: 4, fill: 'var(--text-primary)', strokeWidth: 0 }}
                />

                {/* ET line */}
                <Line
                  yAxisId="temp"
                  dataKey="etActual"
                  stroke="#2563eb"
                  strokeWidth={1.5}
                  dot={false}
                  opacity={0.7}
                  strokeDasharray="5 3"
                  name="Env Temp"
                  connectNulls={false}
                />

                {/* ROR bars */}
                <Bar
                  yAxisId="ror"
                  dataKey="rorActual"
                  fill="#d97706"
                  opacity={0.4}
                  radius={[2, 2, 0, 0]}
                  name="ROR"
                />

                {/* Event markers */}
                {eventMarkers.map((marker, i) => (
                  <ReferenceLine
                    key={i}
                    yAxisId="temp"
                    x={marker.chartLabel}
                    stroke={marker.color}
                    strokeWidth={1.5}
                    label={{
                      value: marker.event,
                      position: 'top',
                      fontSize: 10,
                      fill: marker.color,
                      fontFamily: 'var(--font-body)',
                      fontWeight: 600,
                    }}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Fullscreen Sidebar (only visible in fullscreen) */}
          {isFullscreen && (
            <div style={{
              width: 320,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              padding: '0 0 20px 24px',
              borderLeft: '1px solid var(--border-subtle)',
              overflow: 'hidden',
            }}>
              {/* Stats Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Bean Temp', value: `${currentPoint?.bt ?? '—'}°C`, color: '#ea580c' },
                  { label: 'Env Temp', value: `${currentPoint?.et ?? '—'}°C`, color: '#2563eb' },
                  { label: 'ROR', value: `${rorNow}°/min`, color: '#7c3aed' },
                  { label: 'Time', value: timeStr, color: 'var(--text-primary)' },
                ].map(stat => (
                  <div key={stat.label} style={{ 
                    background: 'var(--bg-secondary)', 
                    padding: '12px 14px', 
                    borderRadius: 12,
                    boxShadow: 'var(--shadow-inset)'
                  }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{stat.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: stat.color, fontFamily: 'var(--font-mono)' }}>{stat.value}</div>
                  </div>
                ))}
              </div>

              {/* Controls */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <h3 style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Controls</h3>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => setIsRunning(r => !r)}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      padding: '12px 0',
                      borderRadius: 9999,
                      border: 'none',
                      background: 'var(--text-primary)',
                      color: 'white',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                      boxShadow: 'var(--shadow-card)'
                    }}
                  >
                    {isRunning ? <Pause size={15} /> : <Play size={15} />}
                    {isRunning ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    onClick={handleEndRoastClick}
                    disabled={roastEnded}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      padding: '12px 0',
                      borderRadius: 9999,
                      border: 'none',
                      background: roastEnded ? 'var(--bg-secondary)' : 'rgba(254,226,226,0.8)',
                      color: roastEnded ? 'var(--text-muted)' : '#dc2626',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: roastEnded ? 'default' : 'pointer',
                      boxShadow: 'var(--shadow-inset)'
                    }}
                  >
                    <Square size={14} />
                    End
                  </button>
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    { label: 'Yellow', shortcut: '⌘1', pressKey: 'Mark Yellow', onClick: () => markEvent('Yellow', 'Color change visible', 'Mark Yellow') },
                    { label: 'FC Start', shortcut: '⌘2', pressKey: 'Mark FC Start', onClick: () => markEvent('FC Start', 'First crack started', 'Mark FC Start') },
                    { label: 'FC End', shortcut: '⌘3', pressKey: 'Mark FC End', onClick: () => markEvent('FC End', 'First crack ended', 'Mark FC End') },
                    { label: 'Add Note', shortcut: '⌘N', pressKey: 'Add Log Note', onClick: handleMarkNote },
                  ].map(({ label, shortcut, pressKey, onClick }) => {
                    const pressed = pressedButtons.has(pressKey);
                    return (
                    <button key={label} onClick={onClick} style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: 4,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: 'none',
                      background: pressed ? 'var(--text-primary)' : 'var(--bg-secondary)',
                      color: pressed ? 'white' : 'var(--text-secondary)',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                      boxShadow: pressed ? 'none' : 'var(--shadow-inset)',
                      transition: 'background 0.15s, color 0.15s',
                    }}>
                      <span>{label}</span>
                      <span style={{ fontSize: 10, color: pressed ? 'rgba(255,255,255,0.6)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', transition: 'color 0.15s' }}>{shortcut}</span>
                    </button>
                  );})}
                </div>
              </div>

              {/* Roast Log */}
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <h3 style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 10, flexShrink: 0 }}>Roast Log</h3>
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {[
                    ...logEntries,
                    ...(!roastEnded ? [{ time: timeStr, event: 'Now', temp: `${currentPoint?.bt}°C`, note: `${phase} in progress`, current: true }] : []),
                  ].map((entry, i, arr) => (
                    <div key={i} style={{
                      display: 'flex',
                      gap: 10,
                      padding: '8px 0',
                      borderBottom: i < arr.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                    }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', width: 32, flexShrink: 0, paddingTop: 2 }}>
                        {entry.time}
                      </div>
                      <div style={{ width: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 4, flexShrink: 0 }}>
                        <div style={{
                          width: 6, height: 6, borderRadius: '50%',
                          background: (entry as any).current ? '#22c55e' : (eventMarkerColor[entry.event] ?? 'var(--border)'),
                          boxShadow: (entry as any).current ? '0 0 0 2px rgba(34,197,94,0.2)' : 'none',
                        }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{entry.event}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>{entry.temp}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{entry.note}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Controls + Notes row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* Controls */}
        <div style={{
          background: 'var(--bg)',
          borderRadius: 16,
          padding: '20px 24px',
          boxShadow: 'var(--shadow-ring)',
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '0.14px', marginBottom: 16 }}>
            Roast Controls
          </h3>
          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            <button
              onClick={() => setIsRunning(r => !r)}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '11px 0',
                borderRadius: 9999,
                border: 'none',
                background: 'var(--text-primary)',
                color: 'white',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                boxShadow: 'var(--shadow-card)',
                letterSpacing: '0.14px',
              }}
            >
              {isRunning ? <Pause size={15} strokeWidth={2} /> : <Play size={15} strokeWidth={2} />}
              {isRunning ? 'Pause' : 'Resume'}
            </button>
            <button
              onClick={handleEndRoastClick}
              disabled={roastEnded}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '11px 0',
                borderRadius: 9999,
                border: 'none',
                background: roastEnded ? 'var(--bg-secondary)' : 'rgba(254,226,226,0.8)',
                color: roastEnded ? 'var(--text-muted)' : '#dc2626',
                fontSize: 14,
                fontWeight: 500,
                cursor: roastEnded ? 'default' : 'pointer',
                letterSpacing: '0.14px',
                boxShadow: 'var(--shadow-inset)',
              }}
            >
              <Square size={14} strokeWidth={2} />
              End Roast
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { label: 'Mark Yellow', shortcut: '⌘1', onClick: () => markEvent('Yellow', 'Color change visible', 'Mark Yellow') },
              { label: 'Mark FC Start', shortcut: '⌘2', onClick: () => markEvent('FC Start', 'First crack started', 'Mark FC Start') },
              { label: 'Mark FC End', shortcut: '⌘3', onClick: () => markEvent('FC End', 'First crack ended', 'Mark FC End') },
              { label: 'Add Log Note', shortcut: '⌘N', onClick: handleMarkNote },
            ].map(({ label, shortcut, onClick }) => {
              const pressed = pressedButtons.has(label);
              return (
              <button key={label} onClick={onClick} style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '9px 12px',
                borderRadius: 8,
                border: 'none',
                background: pressed ? 'var(--text-primary)' : 'var(--bg-secondary)',
                color: pressed ? 'white' : 'var(--text-secondary)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                letterSpacing: '0.14px',
                boxShadow: pressed ? 'none' : 'var(--shadow-inset)',
                transition: 'background 0.15s, color 0.15s',
              }}>
                {label}
                <span style={{ fontSize: 11, color: pressed ? 'rgba(255,255,255,0.6)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', transition: 'color 0.15s' }}>{shortcut}</span>
              </button>
            );})}
          </div>
        </div>

        {/* Roast log */}
        <div style={{
          background: 'var(--bg)',
          borderRadius: 16,
          padding: '20px 24px',
          boxShadow: 'var(--shadow-ring)',
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '0.14px', marginBottom: 14 }}>
            Roast Log
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {[
              ...logEntries,
              ...(!roastEnded ? [{ time: timeStr, event: 'Now', temp: `${currentPoint?.bt}°C`, note: `${phase} in progress`, current: true }] : []),
            ].map((entry, i, arr) => (
              <div key={i} style={{
                display: 'flex',
                gap: 12,
                padding: '10px 0',
                borderBottom: i < arr.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              }}>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  width: 36,
                  flexShrink: 0,
                  paddingTop: 1,
                }}>
                  {entry.time}
                </div>
                <div style={{
                  width: 6,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  paddingTop: 4,
                  flexShrink: 0,
                }}>
                  <div style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: (entry as any).current ? '#22c55e' : 'var(--border)',
                    flexShrink: 0,
                    boxShadow: (entry as any).current ? '0 0 0 3px rgba(34,197,94,0.2)' : 'none',
                  }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '0.14px' }}>
                      {entry.event}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
                      {entry.temp}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.14px' }}>
                    {entry.note}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <EndRoastModal
        open={showEndRoastModal}
        timeStr={timeStr}
        onClose={() => setShowEndRoastModal(false)}
        onConfirm={confirmEndRoast}
      />
      <RoastSummaryModal
        open={showSummaryModal}
        summaryData={summaryData}
        roastNotes={roastNotes}
        eventMarkerColor={eventMarkerColor}
        onRoastNotesChange={setRoastNotes}
        onClose={() => {
          setShowSummaryModal(false);
          setSummaryData(null);
        }}
      />
    </div>
  );
}
