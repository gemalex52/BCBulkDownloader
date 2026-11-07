import React from 'react';
import {
  FolderArchive,
  ShieldCheck,
  Zap,
  Mail,
  Sliders,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';

interface ExtensionPackageCenterProps {
  onDownloadZip: () => void;
  isDownloadingZip?: boolean;
}

export const ExtensionPackageCenter: React.FC<ExtensionPackageCenterProps> = ({
  onDownloadZip,
  isDownloadingZip = false,
}) => {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Top Banner Card */}
      <div className="bg-[#111827] border border-slate-800 rounded-xl p-6 sm:p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded text-[11px] font-semibold bg-cyan-950 text-cyan-300 border border-cyan-800/80">
                Manifest V3 Compliant
              </span>
              <span className="text-xs text-slate-400">
                Chrome · Edge · Brave · Opera
              </span>
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">
              Bandcamp Bulk Downloader Extension
            </h2>
            <p className="text-sm text-slate-300 max-w-xl leading-relaxed">
              Runs directly in your browser with host permissions, bypassing datacenter bot challenges,
              fetching catalog metadata without CORS limits, and managing downloads through the browser download engine.
            </p>
          </div>

          <div className="shrink-0">
            <button
              onClick={onDownloadZip}
              disabled={isDownloadingZip}
              className="flex items-center gap-2.5 px-6 py-3.5 bg-cyan-400 hover:bg-cyan-300 active:bg-cyan-500 text-slate-950 text-sm font-bold rounded-xl transition shadow-lg disabled:opacity-50"
            >
              <FolderArchive className="w-5 h-5" />
              <span>{isDownloadingZip ? 'Packaging ZIP...' : 'Download Extension (.zip)'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Feature Pillars */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-2">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-semibold text-white">Browser IP & Session</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Uses your local browser session and cookies to avoid Bandcamp's Cloudflare "Client Challenge" that blocks datacenter servers.
          </p>
        </div>

        <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-2">
          <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Mail className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-semibold text-white">Automated Watchdog</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Polls your Google Apps Script watchdog to catch email-walled Bandcamp download links and resume downloads automatically.
          </p>
        </div>

        <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 space-y-2">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Sliders className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-semibold text-white">Anti-Captcha Pacing</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Configurable jitter delays (2.5s ± 40%) and cool-down intervals keep your downloads safe from rate limits and CAPTCHAs.
          </p>
        </div>
      </div>

      {/* Fast 3-Step Setup */}
      <div className="bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-cyan-400" />
          <span>Quick 3-Step Installation</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div className="p-4 bg-[#0b0f17] border border-slate-800 rounded-lg space-y-1.5">
            <div className="text-xs font-mono font-bold text-cyan-400">STEP 1</div>
            <div className="text-xs font-semibold text-white">Download & Unzip</div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Click the download button above and extract the downloaded ZIP to any permanent folder on your computer.
            </p>
          </div>

          <div className="p-4 bg-[#0b0f17] border border-slate-800 rounded-lg space-y-1.5">
            <div className="text-xs font-mono font-bold text-cyan-400">STEP 2</div>
            <div className="text-xs font-semibold text-white">Open chrome://extensions</div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Navigate to <code className="text-cyan-300">chrome://extensions</code> in your browser and enable <strong>"Developer mode"</strong> in the top-right.
            </p>
          </div>

          <div className="p-4 bg-[#0b0f17] border border-slate-800 rounded-lg space-y-1.5">
            <div className="text-xs font-mono font-bold text-cyan-400">STEP 3</div>
            <div className="text-xs font-semibold text-white">Load Unpacked</div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Click <strong>"Load unpacked"</strong> and select the extracted folder containing <code className="text-cyan-300">manifest.json</code>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
