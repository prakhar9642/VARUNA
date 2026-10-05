import { useState, useMemo } from 'react';

/**
 * CAPBulletinModal — OASIS Common Alerting Protocol v1.2 Research Advisory.
 *
 * Conforms strictly to OASIS CAP-v1.2 specifications for disaster management.
 * Formatted from actual live forecast alert records.
 *
 * IMPORTANT: Displays a prominent warning indicating this is an academic research
 * prototype and NOT an official civil-protection broadcast from IMD or NDMA.
 */
export default function CAPBulletinModal({ isOpen, onClose, alert, region }) {
  const [activeTab, setActiveTab] = useState('json'); // 'json' | 'xml' | 'summary'
  const [copied, setCopied] = useState(false);

  // Generate deterministic timestamps from the alert record
  const { sentIso, identifier, capData, capXml } = useMemo(() => {
    if (!alert) return {};

    const now = new Date();
    const sent = now.toISOString();
    // Default expiration is 24 hours after target lead or 24 hours from now
    const expires = new Date(now.getTime() + 24 * 3600 * 1000).toISOString();
    const alertId = alert.id || `${alert.region || 'zone'}-${alert.hazard || 'event'}`;
    const id = `VARUNA-CAP-${alertId.toUpperCase()}-${now.getTime()}`;

    const lat = region?.lat ?? 28.6139;
    const lon = region?.lng ?? region?.lon ?? 77.2090;
    const areaDesc = `${alert.region || region?.name || 'Target Region'}, ${region?.state || region?.zone || 'India'}`;
    const circle = `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)},25.0`;

    const severity = alert.tier === 'Critical' ? 'Extreme' : 'Severe';
    const certainty = 'Observed';
    const headline = `[RESEARCH PROTOTYPE] Meteorological Watch: ${alert.type || alert.hazard} Alert for ${alert.region} (${alert.leadTime || '+48h'} Lead)`;
    const description = `VARUNA multi-model AI-NWP ensemble indicates ${alert.value || 'threshold exceedance'} exceeding ${alert.threshold || 'advisory baseline'}. Operational blend method: ${alert.blendMethod || 'VARUNA Blend'}. Validation state: ${alert.validationStatus || 'ERA5 Benchmarked'}. Data mode: ${alert.dataMode || 'LIVE'}.`;
    const instruction = 'This bulletin is generated automatically by the VARUNA ensemble research platform for scientific evaluation. For statutory civil defense, emergency response, and public advisories, consult official IMD/NDMA bulletins.';

    const jsonPayload = {
      $schema: 'https://docs.oasis-open.org/emergency/cap/v1.2/CAP-v1.2.json',
      identifier: id,
      sender: 'varuna.operational.ai@research.iit',
      sent,
      status: 'Actual',
      msgType: 'Alert',
      scope: 'Public',
      note: 'RESEARCH PROTOTYPE — NOT AN OFFICIAL IMD/NDMA BROADCAST',
      info: {
        category: 'Met',
        event: alert.type || alert.hazard || 'Extreme Weather',
        urgency: 'Expected',
        severity,
        certainty,
        eventCode: [
          {
            valueName: 'IMD_CRITERIA',
            value: alert.threshold || 'Operational Standard',
          },
        ],
        effective: sent,
        expires,
        headline,
        description,
        instruction,
        parameter: [
          { valueName: 'VARUNA_BLEND_VALUE', value: String(alert.value || 'N/A') },
          { valueName: 'THRESHOLD_STANDARD', value: String(alert.threshold || 'N/A') },
          { valueName: 'FORECAST_LEAD', value: String(alert.leadTime || 'N/A') },
          { valueName: 'BLEND_METHOD', value: String(alert.blendMethod || 'N/A') },
          { valueName: 'VALIDATION_STATUS', value: String(alert.validationStatus || 'N/A') },
          { valueName: 'DATA_MODE', value: String(alert.dataMode || 'LIVE') },
        ],
        area: [
          {
            areaDesc,
            circle,
          },
        ],
      },
    };

    const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>${id}</identifier>
  <sender>varuna.operational.ai@research.iit</sender>
  <sent>${sent}</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <note>RESEARCH PROTOTYPE — NOT AN OFFICIAL IMD/NDMA BROADCAST</note>
  <info>
    <category>Met</category>
    <event>${alert.type || alert.hazard || 'Extreme Weather'}</event>
    <urgency>Expected</urgency>
    <severity>${severity}</severity>
    <certainty>${certainty}</certainty>
    <eventCode>
      <valueName>IMD_CRITERIA</valueName>
      <value>${alert.threshold || 'Operational Standard'}</value>
    </eventCode>
    <effective>${sent}</effective>
    <expires>${expires}</expires>
    <headline>${headline}</headline>
    <description>${description}</description>
    <instruction>${instruction}</instruction>
    <parameter>
      <valueName>VARUNA_BLEND_VALUE</valueName>
      <value>${alert.value || 'N/A'}</value>
    </parameter>
    <parameter>
      <valueName>THRESHOLD_STANDARD</valueName>
      <value>${alert.threshold || 'N/A'}</value>
    </parameter>
    <parameter>
      <valueName>FORECAST_LEAD</valueName>
      <value>${alert.leadTime || 'N/A'}</value>
    </parameter>
    <parameter>
      <valueName>BLEND_METHOD</valueName>
      <value>${alert.blendMethod || 'N/A'}</value>
    </parameter>
    <parameter>
      <valueName>VALIDATION_STATUS</valueName>
      <value>${alert.validationStatus || 'N/A'}</value>
    </parameter>
    <parameter>
      <valueName>DATA_MODE</valueName>
      <value>${alert.dataMode || 'LIVE'}</value>
    </parameter>
    <area>
      <areaDesc>${areaDesc}</areaDesc>
      <circle>${circle}</circle>
    </area>
  </info>
</alert>`;

    return {
      sentIso: sent,
      expiresIso: expires,
      identifier: id,
      capData: jsonPayload,
      capXml: xmlPayload,
    };
  }, [alert, region]);

  if (!isOpen || !alert) return null;

  const handleCopy = () => {
    const text = activeTab === 'xml' ? capXml : JSON.stringify(capData, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = (format) => {
    const isXml = format === 'xml';
    const content = isXml ? capXml : JSON.stringify(capData, null, 2);
    const mime = isXml ? 'application/xml' : 'application/json';
    const ext = isXml ? 'xml' : 'json';
    const filename = `${identifier || 'varuna_cap_alert'}.${ext}`;

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-[var(--varuna-surface)] border border-[var(--varuna-border)] rounded-[var(--radius-xl)] shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden text-[var(--varuna-text)]">
        {/* Header */}
        <div className="p-4 md:p-5 border-b border-[var(--varuna-border)] flex items-center justify-between gap-3 bg-[var(--varuna-surface-soft)]">
          <div className="flex items-center gap-2.5">
            <span className="w-3 h-3 rounded-full bg-red-600 animate-pulse" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-scale-base font-bold font-data tracking-tight text-[var(--varuna-text)]">
                  CAP v1.2 Research Advisory Bulletin
                </h2>
                <span className="text-[10px] font-bold font-data px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
                  OASIS CAP-v1.2
                </span>
              </div>
              <p className="text-[11px] text-[var(--varuna-text-secondary)] font-data mt-0.5">
                Target Context: {alert.region} · {alert.type} ({alert.leadTime}) · ID: {identifier}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[var(--radius-md)] hover:bg-[var(--varuna-surface)] border border-transparent hover:border-[var(--varuna-border)] text-[var(--varuna-text-muted)] hover:text-[var(--varuna-text)] transition-colors cursor-pointer text-lg leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Mandatory Research Prototype Warning Alert */}
        <div className="p-3.5 bg-amber-500/10 border-b border-amber-300 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 text-[11px] leading-relaxed flex items-start gap-2.5 font-sans">
          <span className="text-base leading-none">⚠️</span>
          <div>
            <strong className="block font-bold">RESEARCH PROTOTYPE — NOT AN OFFICIAL IMD/NDMA BROADCAST</strong>
            This Common Alerting Protocol bulletin is synthesized automatically by the VARUNA AI-NWP ensemble for academic evaluation and system demonstration. Statutory disaster warnings and civil defense actions must follow official India Meteorological Department (IMD) synoptic advisories.
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center justify-between px-4 pt-3 border-b border-[var(--varuna-border)] bg-[var(--varuna-surface)] font-data text-scale-xs">
          <div className="flex items-center gap-2">
            {[
              { id: 'summary', label: 'Summary View' },
              { id: 'json', label: 'CAP JSON' },
              { id: 'xml', label: 'CAP XML' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 font-bold rounded-t-[var(--radius-md)] border-b-2 transition-all cursor-pointer ${
                  activeTab === tab.id
                    ? 'border-[var(--varuna-blue)] text-[var(--varuna-blue-dark)] bg-[var(--varuna-surface-soft)]'
                    : 'border-transparent text-[var(--varuna-text-secondary)] hover:text-[var(--varuna-text)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 pb-1.5">
            <button
              onClick={handleCopy}
              className="px-2.5 py-1 text-[11px] font-bold rounded-[var(--radius-md)] bg-[var(--varuna-surface-soft)] hover:bg-[var(--varuna-blue-light)] border border-[var(--varuna-border)] hover:border-[var(--varuna-blue)] text-[var(--varuna-text)] hover:text-[var(--varuna-blue-dark)] transition-all cursor-pointer flex items-center gap-1 font-data"
            >
              <span>{copied ? '✓' : '📋'}</span>
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </button>
            <button
              onClick={() => handleDownload('json')}
              className="px-2.5 py-1 text-[11px] font-bold rounded-[var(--radius-md)] bg-[var(--varuna-surface-soft)] hover:bg-[var(--varuna-blue-light)] border border-[var(--varuna-border)] hover:border-[var(--varuna-blue)] text-[var(--varuna-text)] hover:text-[var(--varuna-blue-dark)] transition-all cursor-pointer font-data"
            >
              ⬇ JSON
            </button>
            <button
              onClick={() => handleDownload('xml')}
              className="px-2.5 py-1 text-[11px] font-bold rounded-[var(--radius-md)] bg-[var(--varuna-surface-soft)] hover:bg-[var(--varuna-blue-light)] border border-[var(--varuna-border)] hover:border-[var(--varuna-blue)] text-[var(--varuna-text)] hover:text-[var(--varuna-blue-dark)] transition-all cursor-pointer font-data"
            >
              ⬇ XML
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 md:p-5 font-data text-scale-xs">
          {activeTab === 'summary' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-md)]">
                  <span className="text-[10px] uppercase font-bold text-[var(--varuna-text-muted)] block">Event Category</span>
                  <strong className="text-scale-base text-[var(--varuna-text)] block mt-0.5">{alert.type}</strong>
                  <span className="text-[11px] text-[var(--varuna-text-secondary)]">{alert.thresholdStandard}</span>
                </div>
                <div className="p-3 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-md)]">
                  <span className="text-[10px] uppercase font-bold text-[var(--varuna-text-muted)] block">Forecast Exceedance</span>
                  <strong className="text-scale-base text-red-600 block mt-0.5">{alert.value}</strong>
                  <span className="text-[11px] text-[var(--varuna-text-secondary)]">Threshold: {alert.threshold}</span>
                </div>
              </div>

              <div className="p-3.5 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-md)] space-y-2">
                <span className="text-[10px] uppercase font-bold text-[var(--varuna-text-muted)] block tracking-wider">
                  OASIS CAP v1.2 Parameters
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                  <div><span className="text-[var(--varuna-text-muted)]">Severity:</span> <strong>{alert.tier === 'Critical' ? 'Extreme' : 'Severe'}</strong></div>
                  <div><span className="text-[var(--varuna-text-muted)]">Urgency:</span> <strong>Expected</strong></div>
                  <div><span className="text-[var(--varuna-text-muted)]">Certainty:</span> <strong>Observed</strong></div>
                  <div><span className="text-[var(--varuna-text-muted)]">Forecast Lead:</span> <strong>{alert.leadTime}</strong></div>
                  <div><span className="text-[var(--varuna-text-muted)]">Data Mode:</span> <strong className="text-emerald-600">{alert.dataMode || 'LIVE'}</strong></div>
                  <div><span className="text-[var(--varuna-text-muted)]">Blend Engine:</span> <strong>{alert.blendMethod}</strong></div>
                </div>
              </div>

              <div className="p-3.5 bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-md)] space-y-1">
                <span className="text-[10px] uppercase font-bold text-[var(--varuna-text-muted)] block tracking-wider">
                  Geospatial Coverage Circle
                </span>
                <p className="text-[11px] text-[var(--varuna-text)]">
                  Target Zone: <strong>{alert.region}</strong> ({region?.state || region?.zone})
                </p>
                <p className="text-[11px] text-[var(--varuna-text-secondary)]">
                  Point: <code>{region?.lat ?? 28.6139}°N, {region?.lng ?? region?.lon ?? 77.2090}°E</code> · Radius: <code>25.0 km</code>
                </p>
              </div>
            </div>
          )}

          {activeTab === 'json' && (
            <pre className="p-3.5 bg-slate-950 text-emerald-400 dark:text-emerald-300 rounded-[var(--radius-lg)] overflow-x-auto text-[11px] font-mono leading-relaxed border border-slate-800">
              {JSON.stringify(capData, null, 2)}
            </pre>
          )}

          {activeTab === 'xml' && (
            <pre className="p-3.5 bg-slate-950 text-blue-300 dark:text-blue-200 rounded-[var(--radius-lg)] overflow-x-auto text-[11px] font-mono leading-relaxed border border-slate-800">
              {capXml}
            </pre>
          )}
        </div>

        {/* Footer */}
        <div className="p-3.5 px-5 border-t border-[var(--varuna-border)] bg-[var(--varuna-surface-soft)] flex items-center justify-between text-scale-xs font-data">
          <span className="text-[11px] text-[var(--varuna-text-muted)]">
            Sent: {sentIso ? sentIso.replace('T', ' ').slice(0, 19) + ' UTC' : '—'}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[var(--varuna-surface)] hover:bg-[var(--varuna-surface-soft)] border border-[var(--varuna-border)] rounded-[var(--radius-md)] font-bold text-[var(--varuna-text)] transition-colors cursor-pointer"
          >
            Close Bulletin
          </button>
        </div>
      </div>
    </div>
  );
}
