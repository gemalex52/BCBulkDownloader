import React, { useState } from 'react';
import {
  AppSettings,
  AUDIO_FORMATS,
  DEFAULT_APP_SETTINGS,
  formatFilenameBySchema,
  formatInfoZipFilenameBySchema,
} from '../types/bandcamp';
import { GAS_SCRIPT_TEMPLATE } from '../services/gasTemplate';
import { apiClient } from '../services/unifiedClient';
import {
  Save,
  Check,
  RotateCcw,
  Mail,
  FolderArchive,
  Music,
  FileCode,
  Shield,
  Clock,
  Key,
  ExternalLink,
  Copy,
  CheckCheck,
  Send,
  Sliders,
  AlertTriangle,
  Terminal,
} from 'lucide-react';

interface SettingsViewProps {
  settings: AppSettings;
  onUpdateSettings: (newSettings: AppSettings) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const [formState, setFormState] = useState<AppSettings>({
    ...DEFAULT_APP_SETTINGS,
    ...settings,
  });
  const [saved, setSaved] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [testResult, setTestResult] = useState<{ success?: boolean; message?: string } | null>(null);
  const [isTestingWebhook, setIsTestingWebhook] = useState(false);
  const [showCodeModal, setShowCodeModal] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSettings(formState);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = () => {
    setFormState(DEFAULT_APP_SETTINGS);
    onUpdateSettings(DEFAULT_APP_SETTINGS);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleCopyGasTemplate = async () => {
    try {
      await navigator.clipboard.writeText(GAS_SCRIPT_TEMPLATE);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2500);
    } catch (e) {
      console.error('Failed to copy GAS code:', e);
    }
  };

  const handleTestWebhook = async () => {
    if (!formState.gasWebhookUrl.trim()) {
      setTestResult({ success: false, message: 'Please enter a valid Google Apps Script Webhook URL first.' });
      return;
    }

    setIsTestingWebhook(true);
    setTestResult(null);

    try {
      const data = await apiClient.testGasWebhook({
        webhookUrl: formState.gasWebhookUrl.trim(),
        secret: formState.gasSecret.trim(),
      });

      if (data && (data.success || data.ok)) {
        setTestResult({
          success: true,
          message: data.message || 'Webhook responded successfully! Connection verified.',
        });
      } else {
        setTestResult({
          success: false,
          message: data?.error || 'Webhook test failed. Verify URL and secret.',
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Network error connecting to webhook proxy',
      });
    } finally {
      setIsTestingWebhook(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="bg-[#111827] border border-slate-800 rounded-xl p-6">
        <h2 className="text-xl font-bold text-white tracking-tight">
          Downloader & Automation Preferences
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Configure companion info ZIP packaging, automated email-walled link watchdog via Google Apps Script (GAS), anti-captcha pacing, and file naming templates.
        </p>
      </div>

      <form onSubmit={handleSave} className="bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-6">
        {/* Section 1: Companion Info ZIP & Format */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-cyan-400 flex items-center gap-2">
            <FolderArchive className="w-4 h-4" />
            <span>Packaging & Audio Quality</span>
          </h3>

          {/* Companion ZIP Toggle */}
          <div className="p-4 bg-[#0b0f17] border border-slate-700 rounded-lg space-y-2">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formState.createCompanionInfoZip}
                onChange={(e) =>
                  setFormState((prev) => ({
                    ...prev,
                    createCompanionInfoZip: e.target.checked,
                  }))
                }
                className="mt-1 w-4 h-4 rounded bg-slate-900 border-slate-600 text-cyan-500 focus:ring-cyan-500"
              />
              <div className="space-y-1">
                <span className="text-sm font-semibold text-white">
                  Create Companion (info).zip Alongside Audio Release
                </span>
                <p className="text-xs text-slate-400">
                  Separates studio audio from non-audio metadata. Generates a paired archive (e.g.{' '}
                  <code className="text-cyan-300">Artist - 2026.10.30 - Album (info).zip</code>) containing untruncated{' '}
                  <code className="text-cyan-300">info.txt</code> (with full bio, credits, and track info), hi-res{' '}
                  <code className="text-cyan-300">cover.jpg</code>, <code className="text-cyan-300">artist.jpg</code> (from bio_pic), extra album photos in <code className="text-cyan-300">photos/</code>, and synchronized/plain <code className="text-cyan-300">*.lrc</code> lyrics files. Audio tracks are never bundled inside this archive.
                </p>
              </div>
            </label>
          </div>

          {/* Default Download Target Scope */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-white flex items-center gap-2">
              <FolderArchive className="w-4 h-4 text-cyan-400" />
              <span>Default Download Target</span>
            </label>
            <select
              value={formState.defaultDownloadScope || 'both'}
              onChange={(e) =>
                setFormState((prev) => ({
                  ...prev,
                  defaultDownloadScope: e.target.value as 'both' | 'audio' | 'info',
                }))
              }
              className="w-full px-4 py-2.5 bg-[#0b0f17] border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-400"
            >
              <option value="both" className="bg-[#111827]">
                Audio & Companion Info Archive (Both) — Default
              </option>
              <option value="audio" className="bg-[#111827]">
                Studio Audio Master Only (FLAC / MP3)
              </option>
              <option value="info" className="bg-[#111827]">
                Companion Info Archive Only (info.txt, cover, artist, photos, lyrics)
              </option>
            </select>
            <p className="text-xs text-slate-400">
              Can also be customized per-release directly in the Download Dashboard catalog grid or table.
            </p>
          </div>

          {/* Preferred Format */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-white flex items-center gap-2">
              <Music className="w-4 h-4 text-cyan-400" />
              <span>Preferred Audio Format</span>
            </label>
            <select
              value={formState.preferredFormat}
              onChange={(e) =>
                setFormState((prev) => ({ ...prev, preferredFormat: e.target.value }))
              }
              className="w-full px-4 py-2.5 bg-[#0b0f17] border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-400"
            >
              {AUDIO_FORMATS.map((f) => (
                <option key={f.id} value={f.id} className="bg-[#111827]">
                  {f.name} ({f.desc})
                </option>
              ))}
            </select>
          </div>

          {/* Email Auto-Fill */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-white flex items-center gap-2">
              <Mail className="w-4 h-4 text-cyan-400" />
              <span>Auto-Fill Fan Email Address</span>
            </label>
            <input
              type="email"
              value={formState.fallbackEmail}
              onChange={(e) =>
                setFormState((prev) => ({ ...prev, fallbackEmail: e.target.value }))
              }
              placeholder="listener@example.com"
              className="w-full px-4 py-2.5 bg-[#0b0f17] border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
            />
            <p className="text-xs text-slate-400">
              Used when Bandcamp requests an email address to send the download link token for email-walled Name Your Price ($0.00) releases.
            </p>
          </div>

          {/* Debug Console Logs Switch */}
          <div className="p-3 bg-[#0b0f17] border border-slate-700 rounded-lg">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formState.debugLogging || false}
                onChange={(e) =>
                  setFormState((prev) => ({
                    ...prev,
                    debugLogging: e.target.checked,
                  }))
                }
                className="mt-1 w-4 h-4 text-amber-400 bg-slate-900 border-slate-700 rounded focus:ring-amber-400 focus:ring-offset-0"
              />
              <div className="space-y-1">
                <span className="text-sm font-semibold text-white flex items-center gap-1.5">
                  <Terminal className="w-4 h-4 text-amber-400" />
                  <span>Verbose Console Debug Logging</span>
                </span>
                <p className="text-xs text-slate-400">
                  Outputs detailed <code className="text-amber-300">[BandcampDL:...]</code> diagnostic messages in DevTools Console during discography scanning, GAS mailbox queries, statdownload resolution, and audio streaming.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Section 2: Google Apps Script Webhook Watchdog */}
        <div className="space-y-4 pt-4 border-t border-slate-800">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-400 flex items-center gap-2">
              <Key className="w-4 h-4" />
              <span>Email-Walled Watchdog (Google Apps Script)</span>
            </h3>
            <button
              type="button"
              onClick={() => setShowCodeModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-950/60 hover:bg-amber-900/60 text-amber-300 border border-amber-800/60 rounded text-xs font-semibold transition"
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>View GAS Code.gs</span>
            </button>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            Email-walled Bandcamp releases require receiving the signed download link (with unique payment and signature tokens) delivered via Gmail. You can deploy your own Google Apps Script web app that checks for incoming Bandcamp emails and returns the link automatically.
          </p>

          <div className="space-y-3 p-4 bg-[#0b0f17] border border-slate-700 rounded-lg">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Google Apps Script Web App Deployment URL:
              </label>
              <input
                type="url"
                value={formState.gasWebhookUrl}
                onChange={(e) =>
                  setFormState((prev) => ({ ...prev, gasWebhookUrl: e.target.value }))
                }
                placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                className="w-full px-3 py-2 bg-[#111827] border border-slate-700 rounded text-xs text-amber-300 font-mono placeholder-slate-600 focus:outline-none focus:border-amber-400"
              />
              <p className="text-[11px] text-amber-400/90 mt-1 flex items-center gap-1">
                <span>⚠️</span>
                <span><strong>Required Deployment Setting:</strong> In Google Apps Script, set <strong>Who has access: Anyone</strong> (do NOT select "Only myself", otherwise Google requires interactive login and blocks backend calls).</span>
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Secret Password (Matches the SECRET constant in Code.gs):
              </label>
              <input
                type="text"
                value={formState.gasSecret}
                onChange={(e) =>
                  setFormState((prev) => ({ ...prev, gasSecret: e.target.value }))
                }
                placeholder="my_super_secure_pass_123"
                className="w-full px-3 py-2 bg-[#111827] border border-slate-700 rounded text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-amber-400"
              />
            </div>

            {/* Mail Search Timeframe & Start Date Filter */}
            <div className="pt-2 border-t border-slate-800 space-y-3">
              <label className="block text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>Mailbox Search Timeframe (Start Date / Offset):</span>
                <span className="text-[11px] text-amber-400 font-normal">Drastically reduces scanned emails</span>
              </label>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Time Offset Preset:</label>
                  <select
                    value={formState.gasSearchFilterType === 'start_date' ? 'custom' : String(formState.gasSearchOffsetHours || 72)}
                    onChange={(e) => {
                      if (e.target.value === 'custom') {
                        setFormState((prev) => ({
                          ...prev,
                          gasSearchFilterType: 'start_date',
                          gasSearchStartDate: prev.gasSearchStartDate || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
                        }));
                      } else {
                        setFormState((prev) => ({
                          ...prev,
                          gasSearchFilterType: 'offset_hours',
                          gasSearchOffsetHours: parseInt(e.target.value, 10),
                        }));
                      }
                    }}
                    className="w-full px-3 py-2 bg-[#111827] border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-amber-400"
                  >
                    <option value="1">Last 1 Hour</option>
                    <option value="6">Last 6 Hours</option>
                    <option value="24">Last 24 Hours (1 Day)</option>
                    <option value="72">Last 3 Days (Recommended)</option>
                    <option value="168">Last 7 Days (1 Week)</option>
                    <option value="720">Last 30 Days (1 Month)</option>
                    <option value="custom">Specific Start Date (Custom YYYY-MM-DD)</option>
                  </select>
                </div>

                {formState.gasSearchFilterType === 'start_date' ? (
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Search Emails After Date:</label>
                    <input
                      type="date"
                      value={formState.gasSearchStartDate || ''}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          gasSearchFilterType: 'start_date',
                          gasSearchStartDate: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-1.5 bg-[#111827] border border-slate-700 rounded text-xs text-amber-300 font-mono focus:outline-none focus:border-amber-400"
                    />
                  </div>
                ) : (
                  <div className="flex items-center text-xs text-slate-400 px-2 pt-4">
                    <span>Searching Gmail for releases delivered in the past {formState.gasSearchOffsetHours || 72} hours.</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div className="p-2.5 bg-[#111827] border border-slate-700 rounded space-y-1">
                  <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span>GAS Mail Check Timeout (seconds):</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="10"
                      max="300"
                      step="5"
                      value={formState.gasMailCheckTimeoutSeconds ?? 90}
                      onChange={(e) => {
                        const sec = parseInt(e.target.value, 10) || 90;
                        setFormState((prev) => ({
                          ...prev,
                          gasMailCheckTimeoutSeconds: sec,
                          gasMaxPollCycles: Math.ceil(sec / 5),
                        }));
                      }}
                      className="w-20 px-2.5 py-1 bg-[#0b0f17] border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-amber-400"
                    />
                    <span className="text-[11px] text-slate-400">
                      seconds ({Math.ceil((formState.gasMailCheckTimeoutSeconds ?? 90) / 5)} poll cycles at 5s)
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-slate-400">
                <strong>Policy:</strong> Never sends new Bandcamp download request emails if an active download link is already found in your mailbox.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleTestWebhook}
                disabled={isTestingWebhook || !formState.gasWebhookUrl.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded text-xs font-semibold border border-slate-600 transition"
              >
                <Send className="w-3.5 h-3.5 text-amber-400" />
                <span>{isTestingWebhook ? 'Testing...' : 'Test Webhook Connection'}</span>
              </button>

              <button
                type="button"
                onClick={handleCopyGasTemplate}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 rounded text-xs font-semibold border border-amber-500/30 transition"
              >
                {copiedCode ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedCode ? 'Copied Code.gs!' : 'Copy Code.gs Script'}</span>
              </button>
            </div>

            {testResult && (
              <div
                className={`p-2.5 rounded text-xs font-medium ${
                  testResult.success
                    ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-300'
                    : 'bg-red-950/60 border border-red-800 text-red-300'
                }`}
              >
                {testResult.message}
              </div>
            )}
          </div>
        </div>

        {/* Section 3: Anti-Captcha Pacing & Cool-Down */}
        <div className="space-y-4 pt-4 border-t border-slate-800">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
            <Sliders className="w-4 h-4" />
            <span>Anti-Captcha Pacing & Cool-Down Delays</span>
          </h3>
          <p className="text-xs text-slate-400">
            Applying randomized jitter delays between requests prevents bot detection and Cloudflare 429 rate limits.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3 bg-[#0b0f17] border border-slate-700 rounded-lg space-y-1.5">
              <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                <span>Base Delay Between Downloads:</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0.5"
                  max="30"
                  step="0.5"
                  value={formState.pacingBaseDelaySeconds}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      pacingBaseDelaySeconds: parseFloat(e.target.value) || 2.5,
                    }))
                  }
                  className="w-24 px-3 py-1.5 bg-[#111827] border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-emerald-400"
                />
                <span className="text-xs text-slate-400">seconds (e.g. 2.5s)</span>
              </div>
            </div>

            <div className="p-3 bg-[#0b0f17] border border-slate-700 rounded-lg space-y-1.5">
              <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                <span>Random Jitter Variation:</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="5"
                  value={formState.pacingJitterPercent}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      pacingJitterPercent: parseInt(e.target.value, 10) || 40,
                    }))
                  }
                  className="w-24 px-3 py-1.5 bg-[#111827] border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-emerald-400"
                />
                <span className="text-xs text-slate-400">% (e.g. ±40% is 1.5s - 3.5s)</span>
              </div>
            </div>

            <div className="p-3 bg-[#0b0f17] border border-slate-700 rounded-lg space-y-1.5">
              <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                <span>Cool-Down Frequency:</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="50"
                  step="1"
                  value={formState.cooldownBatchInterval}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      cooldownBatchInterval: parseInt(e.target.value, 10) || 5,
                    }))
                  }
                  className="w-24 px-3 py-1.5 bg-[#111827] border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-emerald-400"
                />
                <span className="text-xs text-slate-400">downloads per batch</span>
              </div>
            </div>

            <div className="p-3 bg-[#0b0f17] border border-slate-700 rounded-lg space-y-1.5">
              <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                <span>Cool-Down Duration:</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="2"
                  max="120"
                  step="1"
                  value={formState.cooldownDurationSeconds}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      cooldownDurationSeconds: parseInt(e.target.value, 10) || 12,
                    }))
                  }
                  className="w-24 px-3 py-1.5 bg-[#111827] border border-slate-700 rounded text-xs text-white focus:outline-none focus:border-emerald-400"
                />
                <span className="text-xs text-slate-400">seconds pause</span>
              </div>
            </div>
          </div>
        </div>

        {/* Section 4: File Naming Schema */}
        <div className="space-y-3 pt-4 border-t border-slate-800">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-white flex items-center gap-2">
              <FileCode className="w-4 h-4 text-cyan-400" />
              <span>File Naming Schema (%meta_field%)</span>
            </label>
            <button
              type="button"
              onClick={() =>
                setFormState((prev) => ({
                  ...prev,
                  namingSchema: '%artist% - %date% - %album%[%title%.%format%]',
                }))
              }
              className="text-[11px] text-cyan-400 hover:text-cyan-300 font-medium"
            >
              Reset to Default
            </button>
          </div>

          <input
            type="text"
            value={formState.namingSchema}
            onChange={(e) =>
              setFormState((prev) => ({ ...prev, namingSchema: e.target.value }))
            }
            placeholder="%artist% - %date% - %album%[%title%.%format%]"
            className="w-full px-4 py-2.5 bg-[#0b0f17] border border-slate-700 rounded-lg text-sm text-cyan-300 font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-400"
          />

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-400 font-medium mr-1">Insert tag token:</span>
            {[
              { token: '%artist%', label: 'Artist' },
              { token: '%date%', label: 'Date (YYYY.MM.DD)' },
              { token: '%year%', label: 'Year' },
              { token: '%album%', label: 'Album' },
              { token: '%track_num%', label: 'Track #' },
              { token: '%title%', label: 'Title' },
              { token: '%format%', label: 'Format' },
            ].map((t) => (
              <button
                key={t.token}
                type="button"
                onClick={() => {
                  const current = formState.namingSchema || '';
                  if (!current.includes(t.token)) {
                    setFormState((prev) => ({
                      ...prev,
                      namingSchema: `${current.replace(/\.%format%$/, '')} - ${t.token}.%format%`,
                    }));
                  }
                }}
                className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 rounded text-[11px] font-mono text-cyan-400 hover:text-white transition"
              >
                +{t.label}
              </button>
            ))}
          </div>

          <p className="text-xs text-slate-400">
            For whole-album archives, the track-related portion <code className="text-cyan-300">[%title%.%format%]</code> is automatically omitted, producing clean album zip archives like <code className="text-cyan-300">Artist - 2026.10.30 - Album.zip</code>.
          </p>

          <div className="p-3 bg-[#0b0f17] border border-slate-800 rounded-lg text-xs space-y-1">
            <div className="text-slate-400">Single-track release preview:</div>
            <div className="font-mono text-emerald-400 font-medium">
              {formatFilenameBySchema(
                formState.namingSchema || '%artist% - %date% - %album%[%title%.%format%]',
                {
                  artist: 'Esoctrilihum',
                  album: 'CYPH WVNG',
                  title: 'CYPH WVNG',
                  trackNum: 1,
                  totalTracks: 1,
                  date: '2026.01.28',
                  year: '2026',
                  format: formState.preferredFormat || 'flac',
                  type: 'track',
                }
              )}
            </div>
            <div className="text-slate-400 pt-1">Multitrack album archive preview (track title auto-omitted):</div>
            <div className="font-mono text-sky-400 font-medium">
              {formatFilenameBySchema(
                formState.namingSchema || '%artist% - %date% - %album%[%title%.%format%]',
                {
                  artist: 'Othaliel',
                  album: 'Eternal Life in Metastasized Dreams',
                  title: '',
                  trackNum: undefined,
                  totalTracks: 3,
                  date: '2026.03.03',
                  year: '2026',
                  format: 'zip',
                  type: 'album',
                  isArchive: true,
                }
              )}
            </div>
          </div>

          {/* Sub-Section 4b: Companion Info ZIP Naming Schema */}
          <div className="pt-4 border-t border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-white flex items-center gap-2">
                <FolderArchive className="w-4 h-4 text-indigo-400" />
                <span>Companion (info).zip Naming Schema</span>
              </label>
              <button
                type="button"
                onClick={() =>
                  setFormState((prev) => ({
                    ...prev,
                    infoZipNamingSchema: '%artist% - %date% - %album% (info)',
                  }))
                }
                className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium"
              >
                Reset to Default
              </button>
            </div>

            <input
              type="text"
              value={formState.infoZipNamingSchema || '%artist% - %date% - %album% (info)'}
              onChange={(e) =>
                setFormState((prev) => ({ ...prev, infoZipNamingSchema: e.target.value }))
              }
              placeholder="%artist% - %date% - %album% (info)"
              className="w-full px-4 py-2.5 bg-[#0b0f17] border border-slate-700 rounded-lg text-sm text-indigo-300 font-mono placeholder-slate-500 focus:outline-none focus:border-indigo-400"
            />

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400 font-medium mr-1">Insert tag token:</span>
              {[
                { token: '%artist%', label: 'Artist' },
                { token: '%date%', label: 'Date (YYYY.MM.DD)' },
                { token: '%year%', label: 'Year' },
                { token: '%album%', label: 'Album' },
                { token: '%title%', label: 'Title' },
              ].map((t) => (
                <button
                  key={t.token}
                  type="button"
                  onClick={() => {
                    const current = formState.infoZipNamingSchema || '%artist% - %date% - %album% (info)';
                    if (!current.includes(t.token)) {
                      setFormState((prev) => ({
                        ...prev,
                        infoZipNamingSchema: `${current} ${t.token}`,
                      }));
                    }
                  }}
                  className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 rounded text-[11px] font-mono text-indigo-400 hover:text-white transition"
                >
                  +{t.label}
                </button>
              ))}
            </div>

            <div className="p-3 bg-[#0b0f17] border border-slate-800 rounded-lg text-xs space-y-1">
              <div className="text-slate-400">Companion Info ZIP output preview:</div>
              <div className="font-mono text-indigo-400 font-medium">
                {formatInfoZipFilenameBySchema(
                  formState.infoZipNamingSchema || '%artist% - %date% - %album% (info)',
                  {
                    artist: 'Othaliel',
                    album: 'Eternal Life in Metastasized Dreams',
                    title: 'Eternal Life in Metastasized Dreams',
                    date: '2026.03.03',
                    year: '2026',
                    type: 'album',
                  }
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-lg text-xs font-medium border border-slate-700 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restore Defaults</span>
          </button>

          <div className="flex items-center gap-3">
            {saved && (
              <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                <Check className="w-4 h-4" />
                <span>Preferences Saved</span>
              </span>
            )}
            <button
              type="submit"
              className="flex items-center gap-1.5 px-5 py-2.5 bg-cyan-400 hover:bg-cyan-300 active:bg-cyan-500 text-slate-950 rounded-lg text-xs font-bold transition shadow-sm"
            >
              <Save className="w-4 h-4" />
              <span>Save Preferences</span>
            </button>
          </div>
        </div>
      </form>

      {/* Code.gs Modal */}
      {showCodeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-[#111827] border border-slate-700 rounded-xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <FileCode className="w-5 h-5 text-amber-400" />
                  <span>Google Apps Script (Code.gs) Template</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Deploy as a Web App in Google Apps Script with access set to "Anyone".
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCodeModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded"
              >
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 font-mono text-xs text-slate-300 bg-[#090d16] select-all whitespace-pre leading-relaxed border-y border-slate-800">
              {GAS_SCRIPT_TEMPLATE}
            </div>

            <div className="p-4 flex items-center justify-between bg-[#111827]">
              <span className="text-xs text-slate-400">
                Set <code className="text-amber-300">SECRET = '{formState.gasSecret || 'your_secret_password'}'</code>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyGasTemplate}
                  className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg text-xs font-bold transition"
                >
                  {copiedCode ? <CheckCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedCode ? 'Copied to Clipboard!' : 'Copy Code.gs'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowCodeModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
