import React, { useState } from 'react';
import { EXTENSION_FILES, createExtensionZip } from '../services/extensionPackage';
import {
  FolderArchive,
  Copy,
  Check,
  FileCode,
  ShieldCheck,
  Play,
  Download,
  Terminal,
  ExternalLink,
  Laptop
} from 'lucide-react';

interface ExtensionPackageCenterProps {
  onDownloadZip: () => void;
  isDownloadingZip?: boolean;
}

export const ExtensionPackageCenter: React.FC<ExtensionPackageCenterProps> = ({
  onDownloadZip,
  isDownloadingZip = false,
}) => {
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);

  const activeFile = EXTENSION_FILES[activeFileIndex] || EXTENSION_FILES[0];

  const handleCopyCode = () => {
    navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Card */}
      <div className="bg-[#111827] border border-slate-800 rounded-xl p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded text-[11px] font-semibold bg-cyan-950 text-cyan-300 border border-cyan-800/80">
                Manifest V3 Compliant
              </span>
              <span className="text-xs text-slate-400">
                Chrome · Edge · Brave · Opera
              </span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">
              Chrome Extension Package Center
            </h2>
            <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
              This extension runs natively in your browser with elevated host permissions,
              allowing it to inspect Bandcamp artist catalogs, fetch album sub-pages without CORS barriers,
              and trigger batch downloads through the Chrome Downloads API.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              onClick={() => setShowSimulator(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition"
            >
              <Laptop className="w-4 h-4 text-cyan-400" />
              <span>Preview Popup UI</span>
            </button>
            <button
              onClick={onDownloadZip}
              disabled={isDownloadingZip}
              className="flex items-center gap-2 px-5 py-2.5 bg-cyan-400 hover:bg-cyan-300 active:bg-cyan-500 text-slate-950 text-xs font-bold rounded-lg transition shadow-md disabled:opacity-50"
            >
              <FolderArchive className="w-4 h-4" />
              <span>{isDownloadingZip ? 'Packaging Extension...' : 'Download Extension (.zip)'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Code Inspector Tabs & Content */}
      <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden shadow-lg">
        {/* File tabs navigation */}
        <div className="flex items-center justify-between bg-[#0b0f17] border-b border-slate-800 px-4">
          <div className="flex items-center gap-1 overflow-x-auto py-2">
            {EXTENSION_FILES.map((file, idx) => (
              <button
                key={file.path}
                onClick={() => setActiveFileIndex(idx)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition whitespace-nowrap ${
                  activeFileIndex === idx
                    ? 'bg-slate-800 text-cyan-400 font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <FileCode className="w-3.5 h-3.5" />
                <span>{file.name}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 pl-4 py-2 shrink-0">
            <button
              onClick={handleCopyCode}
              className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md text-xs font-medium border border-slate-700 transition"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Code</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* File Description Header */}
        <div className="px-5 py-2.5 bg-[#0e1626] border-b border-slate-800/80 text-xs text-slate-400 flex items-center justify-between">
          <span>{activeFile.description}</span>
          <span className="font-mono text-slate-500 uppercase">{activeFile.language}</span>
        </div>

        {/* Code Content Container */}
        <div className="p-5 overflow-x-auto bg-[#070b12] max-h-[500px] overflow-y-auto">
          <pre className="text-xs font-mono text-slate-200 leading-relaxed">
            <code>{activeFile.content}</code>
          </pre>
        </div>
      </div>

      {/* Simulated Popup Modal */}
      {showSimulator && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#0b0f17] border border-cyan-500/40 rounded-2xl w-[440px] overflow-hidden shadow-2xl flex flex-col">
            <div className="px-4 py-2.5 bg-[#111827] border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                Chrome Extension Popup Simulator
              </span>
              <button
                onClick={() => setShowSimulator(false)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Close ✕
              </button>
            </div>

            {/* Simulated Chrome Extension Popup Content */}
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-xs">
                    BC
                  </div>
                  <span className="font-bold text-sm text-white">Bandcamp Bulk DL</span>
                </div>
                <span className="text-xs text-slate-400 font-mono">v1.2.0</span>
              </div>

              <div className="p-3 bg-[#111827] rounded-lg border border-slate-800 space-y-2">
                <div className="text-xs text-slate-400">Active Tab:</div>
                <div className="text-xs font-mono text-cyan-300 truncate">
                  https://esoctrilihum.bandcamp.com/music
                </div>
                <button
                  type="button"
                  className="w-full py-2 bg-cyan-500 text-slate-950 font-bold text-xs rounded-md shadow-sm"
                >
                  Scan Current Discography
                </button>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>Found Releases: 7</span>
                  <span className="text-emerald-400">5 Free / NYP ($0)</span>
                </div>
                <div className="p-2.5 bg-[#111827] rounded border border-slate-800 text-[11px] text-slate-300 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white">Eph'Al-Ghul</span>
                    <span className="text-amber-400 font-medium">Name Your Price $0</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white">Astra Portalum</span>
                    <span className="text-emerald-400 font-medium">Free Download</span>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-xs">
                <span className="text-slate-400">Format: MP3 320k</span>
                <span className="text-cyan-400 font-semibold cursor-pointer">Options ⚙️</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
