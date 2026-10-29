import React from 'react';
import {
  Download,
  FolderArchive,
  CheckCircle,
  HelpCircle,
  Terminal,
  ExternalLink,
  ShieldCheck,
  Disc3,
  Layers
} from 'lucide-react';

interface InstallGuideProps {
  onDownloadZip: () => void;
}

export const InstallGuide: React.FC<InstallGuideProps> = ({ onDownloadZip }) => {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Hero card */}
      <div className="bg-[#111827] border border-slate-800 rounded-xl p-6">
        <h2 className="text-xl font-bold text-white tracking-tight">
          How to Install the Extension in Google Chrome
        </h2>
        <p className="text-sm text-slate-400 mt-2 leading-relaxed">
          Google Chrome and Chromium-based browsers (Brave, Microsoft Edge, Opera, Vivaldi) allow
          loading developer extensions instantly with no web store submission needed. Follow these 4 quick steps:
        </p>
      </div>

      {/* Steps List */}
      <div className="space-y-4">
        {/* Step 1 */}
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 flex gap-4">
          <div className="w-8 h-8 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center font-bold text-cyan-400 text-sm shrink-0">
            1
          </div>
          <div className="space-y-2 flex-1">
            <h3 className="text-base font-semibold text-white">
              Download and Extract the Extension Package
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Click the button below to download <code className="text-cyan-300">bandcamp-bulk-downloader-extension.zip</code>.
              Once downloaded, right-click and extract/unzip the contents to a folder on your computer (e.g. your Downloads or Documents folder).
            </p>
            <div className="pt-2">
              <button
                onClick={onDownloadZip}
                className="flex items-center gap-2 px-4 py-2 bg-cyan-400 hover:bg-cyan-300 active:bg-cyan-500 text-slate-950 text-xs font-bold rounded-lg transition shadow-sm"
              >
                <FolderArchive className="w-4 h-4" />
                <span>Download Extension (.zip)</span>
              </button>
            </div>
          </div>
        </div>

        {/* Step 2 */}
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 flex gap-4">
          <div className="w-8 h-8 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center font-bold text-cyan-400 text-sm shrink-0">
            2
          </div>
          <div className="space-y-2 flex-1">
            <h3 className="text-base font-semibold text-white">
              Open the Extensions Management Page
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Open a new tab in Google Chrome, paste the following URL into your address bar, and press Enter:
            </p>
            <div className="p-3 bg-[#0b0f17] border border-slate-700/80 rounded-lg text-xs font-mono text-cyan-400 flex items-center justify-between">
              <span>chrome://extensions</span>
              <span className="text-slate-500 text-[11px] font-sans">
                (Brave: brave://extensions · Edge: edge://extensions)
              </span>
            </div>
          </div>
        </div>

        {/* Step 3 */}
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 flex gap-4">
          <div className="w-8 h-8 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center font-bold text-cyan-400 text-sm shrink-0">
            3
          </div>
          <div className="space-y-2 flex-1">
            <h3 className="text-base font-semibold text-white">
              Toggle "Developer mode" and Click "Load unpacked"
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              In the top-right corner of the Extensions page, toggle the switch for <strong>Developer mode</strong> ON.
              Then click the <strong>"Load unpacked"</strong> button that appears in the top-left toolbar.
            </p>
            <div className="p-3 bg-[#0b0f17] border border-slate-800 rounded-lg text-xs text-slate-300">
              Select the unzipped folder containing the <code className="text-cyan-300">manifest.json</code> file.
            </div>
          </div>
        </div>

        {/* Step 4 */}
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 flex gap-4">
          <div className="w-8 h-8 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center font-bold text-cyan-400 text-sm shrink-0">
            4
          </div>
          <div className="space-y-2 flex-1">
            <h3 className="text-base font-semibold text-white">
              Pin and Start Downloading from Bandcamp!
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Click the extensions puzzle icon in Chrome's top toolbar, pin <strong>Bandcamp Bulk DL</strong>,
              and navigate to any artist page like <code className="text-cyan-300">https://esoctrilihum.bandcamp.com/music</code>.
              Click the extension icon to scan all releases, choose your format (MP3 320, FLAC, AAC, WAV), and download!
            </p>
          </div>
        </div>
      </div>

      {/* Frequently Asked Questions */}
      <div className="bg-[#111827] border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-cyan-400" />
          <span>Frequently Asked Questions</span>
        </h3>

        <div className="space-y-3 text-xs">
          <div className="p-3 bg-[#0b0f17] rounded-lg border border-slate-800">
            <div className="font-semibold text-white">How does it handle "Name Your Price" albums?</div>
            <p className="text-slate-400 mt-1">
              Many artists offer albums as "Name Your Price" with a minimum of $0.00.
              The extension identifies these as free, inputs 0, and if Bandcamp requests an email address,
              auto-fills your configured fallback email address to retrieve the download link.
            </p>
          </div>

          <div className="p-3 bg-[#0b0f17] rounded-lg border border-slate-800">
            <div className="font-semibold text-white">Why does it skip album track sub-pages?</div>
            <p className="text-slate-400 mt-1">
              Per your requirement, when scanning a full artist discography, scanning individual track URLs
              belonging to an already detected album causes duplicate work and rate-limiting.
              The crawler visits full album pages directly to capture entire albums in one download.
            </p>
          </div>

          <div className="p-3 bg-[#0b0f17] rounded-lg border border-slate-800">
            <div className="font-semibold text-white">What audio formats are supported?</div>
            <p className="text-slate-400 mt-1">
              Bandcamp natively generates MP3 320kbps, FLAC (Lossless), AAC (VBR), ALAC, WAV, and AIFF.
              You can choose your format in the popup before triggering download.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
