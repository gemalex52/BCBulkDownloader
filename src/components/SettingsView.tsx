import React, { useState } from 'react';
import { AppSettings, AUDIO_FORMATS, DeliveryMode, formatFilenameBySchema } from '../types/bandcamp';
import { Save, Check, RotateCcw, Mail, FolderArchive, Music, FileCode, Calendar } from 'lucide-react';

interface SettingsViewProps {
  settings: AppSettings;
  onUpdateSettings: (newSettings: AppSettings) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const [formState, setFormState] = useState<AppSettings>({
    ...settings,
    preferredFormat: settings.preferredFormat || 'flac',
    deliveryMode: settings.deliveryMode || 'zip',
    namingSchema: settings.namingSchema || '%artist% - %date% - %album%/[%track_num%. ]%title%.%format%',
  });
  const [saved, setSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSettings(formState);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleReset = () => {
    const defaults: AppSettings = {
      fallbackEmail: 'listener@example.com',
      preferredFormat: 'flac',
      deliveryMode: 'zip',
      concurrentDownloads: 3,
      skipEmailRequired: false,
      skipAlbumTrackSubpages: true,
      namingSchema: '%artist% - %date% - %album%/[%track_num%. ]%title%.%format%',
    };
    setFormState(defaults);
    onUpdateSettings(defaults);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-[#111827] border border-slate-800 rounded-xl p-6">
        <h2 className="text-xl font-bold text-white tracking-tight">
          Downloader & Extension Preferences
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Configure default behaviors for bulk downloading, genuine FLAC/320 format negotiation, and custom metadata tagging.
        </p>
      </div>

      <form onSubmit={handleSave} className="bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-6">
        {/* Email Auto-Fill */}
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-white flex items-center gap-2">
            <Mail className="w-4 h-4 text-cyan-400" />
            <span>Fallback Auto-Fill Email Address</span>
          </label>
          <input
            type="email"
            value={formState.fallbackEmail}
            onChange={(e) =>
              setFormState((prev) => ({ ...prev, fallbackEmail: e.target.value }))
            }
            placeholder="fan@example.com"
            className="w-full px-4 py-2.5 bg-[#0b0f17] border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
          />
          <p className="text-xs text-slate-400">
            Some artists configure "Name Your Price" ($0.00) to require an email to receive the download token.
            This email is sent automatically to prevent checkout interruption.
          </p>
        </div>

        {/* Default Format */}
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-white flex items-center gap-2">
            <Music className="w-4 h-4 text-cyan-400" />
            <span>Default Audio Format (Lossless Master FLAC by Default)</span>
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

        {/* Default Delivery Mode */}
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-white flex items-center gap-2">
            <FolderArchive className="w-4 h-4 text-cyan-400" />
            <span>Default Bulk Packaging Mode (ZIP by Default)</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label
              className={`p-3 rounded-lg border cursor-pointer transition flex items-start gap-3 ${
                formState.deliveryMode === 'zip'
                  ? 'bg-cyan-950/40 border-cyan-500/60 text-white'
                  : 'bg-[#0b0f17] border-slate-700 text-slate-400 hover:border-slate-600'
              }`}
            >
              <input
                type="radio"
                name="deliveryMode"
                value="zip"
                checked={formState.deliveryMode === 'zip'}
                onChange={() =>
                  setFormState((prev) => ({ ...prev, deliveryMode: 'zip' }))
                }
                className="mt-1 text-cyan-500"
              />
              <div>
                <div className="font-semibold text-xs text-white">Bundled ZIP Archive (Recommended)</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Packages genuine audio files, hi-res <code className="text-cyan-300">cover.jpg</code>, extra photos, and full <code className="text-cyan-300">info.txt</code>.
                </div>
              </div>
            </label>

            <label
              className={`p-3 rounded-lg border cursor-pointer transition flex items-start gap-3 ${
                formState.deliveryMode === 'individual'
                  ? 'bg-cyan-950/40 border-cyan-500/60 text-white'
                  : 'bg-[#0b0f17] border-slate-700 text-slate-400 hover:border-slate-600'
              }`}
            >
              <input
                type="radio"
                name="deliveryMode"
                value="individual"
                checked={formState.deliveryMode === 'individual'}
                onChange={() =>
                  setFormState((prev) => ({ ...prev, deliveryMode: 'individual' }))
                }
                className="mt-1 text-cyan-500"
              />
              <div>
                <div className="font-semibold text-xs text-white">Individual Files</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Initiates separate sequential browser downloads for each release with subfolders converted to hyphens.
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* File Naming Schema */}
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
                  namingSchema: '%artist% - %date% - %album% - %track_num% - %title%.%format%',
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
            placeholder="%artist% - %date% - %album% - %track_num% - %title%.%format%"
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
            Enclose optional segments inside <code className="text-cyan-300">[ ... ]</code>: they will only be rendered if all referenced metadata fields are non-empty (e.g. <code className="text-cyan-300">[%track_num%. ]</code> only appears on multitrack releases). Use <code className="text-cyan-300">\[</code> and <code className="text-cyan-300">\]</code> for literal brackets. Use <code className="text-cyan-300">/</code> or <code className="text-cyan-300">\</code> for subfolder nesting in ZIP bundles (e.g. <code className="text-cyan-300">%artist% - %date% - %album%/[%track_num%. ]%title%.%format%</code>).
          </p>

          <div className="p-3 bg-[#0b0f17] border border-slate-800 rounded-lg text-xs space-y-1">
            <div className="text-slate-400">Single-track preview (no track#):</div>
            <div className="font-mono text-emerald-400 font-medium">
              {formatFilenameBySchema(
                formState.namingSchema || '%artist% - %date% - %album%/[%track_num%. ]%title%.%format%',
                {
                  artist: 'Esoctrilihum',
                  album: 'CYPH WVNG',
                  title: 'CYPH WVNG',
                  trackNum: 1,
                  totalTracks: 1,
                  date: '2026.01.28',
                  year: '2026',
                  format: formState.preferredFormat || 'flac',
                  type: 'track'
                },
                { allowSubfolders: formState.deliveryMode === 'zip' }
              )}
            </div>
            <div className="text-slate-400 pt-1">Multitrack album preview (with 0-padded track#):</div>
            <div className="font-mono text-sky-400 font-medium">
              {formatFilenameBySchema(
                formState.namingSchema || '%artist% - %date% - %album%/[%track_num%. ]%title%.%format%',
                {
                  artist: 'Esoctrilihum',
                  album: 'Funeral',
                  title: 'The Cry',
                  trackNum: 3,
                  totalTracks: 12,
                  date: '2026.05.15',
                  year: '2026',
                  format: formState.preferredFormat || 'flac',
                  type: 'album'
                },
                { allowSubfolders: formState.deliveryMode === 'zip' }
              )}
            </div>
          </div>
        </div>

        {/* Subpage Crawling Filter */}
        <div className="pt-2 border-t border-slate-800 space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={formState.skipAlbumTrackSubpages}
              onChange={(e) =>
                setFormState((prev) => ({
                  ...prev,
                  skipAlbumTrackSubpages: e.target.checked,
                }))
              }
              className="mt-1 w-4 h-4 rounded bg-slate-900 border-slate-700 text-cyan-500"
            />
            <div>
              <span className="text-sm font-semibold text-white">
                Exclude album track sub-pages
              </span>
              <p className="text-xs text-slate-400 mt-0.5">
                When crawling an artist discography, skip individual track URLs linked within albums to avoid duplicate requests.
              </p>
            </div>
          </label>
        </div>

        {/* Buttons */}
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
    </div>
  );
};
