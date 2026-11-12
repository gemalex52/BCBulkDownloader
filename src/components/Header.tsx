import React from 'react';
import { Download, Sparkles, FolderArchive } from 'lucide-react';
import { isExtension } from '../services/unifiedClient';

interface HeaderProps {
  currentTab: 'scanner' | 'extension' | 'guide' | 'settings';
  onSelectTab: (tab: 'scanner' | 'extension' | 'guide' | 'settings') => void;
  onDownloadZip: () => void;
  isDownloadingZip?: boolean;
  debugLogging?: boolean;
  onToggleDebugLogging?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onSelectTab,
  onDownloadZip,
  isDownloadingZip = false,
  debugLogging = false,
  onToggleDebugLogging,
}) => {
  return (
    <header className="border-b border-slate-800 bg-[#0d131f] sticky top-0 z-40 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Brand title */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-[#0b0f17] border border-cyan-500/30 flex items-center justify-center p-1 shadow-sm">
            <svg className="w-full h-full" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="128" height="128" rx="26" fill="#0b0f17"/>
              <path d="M26 86 L50 26 H86 L62 86 Z" fill="#00b4d8"/>
              <path d="M68 38 V64 H56 L76 90 L96 64 H84 V38 Z" fill="#ffffff"/>
              <rect x="56" y="96" width="40" height="6" rx="3" fill="#38bdf8"/>
            </svg>
          </div>
          <span className="text-base font-bold tracking-tight text-white whitespace-nowrap">
            Bandcamp Bulk Downloader {isExtension && <span className="text-xs font-mono text-cyan-400 font-normal px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800/60 ml-1">Extension</span>}
          </span>
        </div>

        {/* Zone 2: Navigation tabs */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          <button
            onClick={() => onSelectTab('scanner')}
            className={`whitespace-nowrap transition-colors py-1 ${
              currentTab === 'scanner'
                ? 'text-cyan-400 border-b-2 border-cyan-400 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Download Dashboard
          </button>
          {!isExtension && (
            <>
              <button
                onClick={() => onSelectTab('extension')}
                className={`whitespace-nowrap transition-colors py-1 ${
                  currentTab === 'extension'
                    ? 'text-cyan-400 border-b-2 border-cyan-400 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Extension Package
              </button>
              <button
                onClick={() => onSelectTab('guide')}
                className={`whitespace-nowrap transition-colors py-1 ${
                  currentTab === 'guide'
                    ? 'text-cyan-400 border-b-2 border-cyan-400 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Install Guide
              </button>
            </>
          )}
          <button
            onClick={() => onSelectTab('settings')}
            className={`whitespace-nowrap transition-colors py-1 ${
              currentTab === 'settings'
                ? 'text-cyan-400 border-b-2 border-cyan-400 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Preferences
          </button>
        </nav>

        {/* Zone 3: Actions + Debug Switch */}
        <div className="flex items-center gap-3 shrink-0">
          {onToggleDebugLogging && (
            <button
              onClick={onToggleDebugLogging}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono rounded-md border transition-colors ${
                debugLogging
                  ? 'bg-amber-950/80 border-amber-500/50 text-amber-300'
                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
              title="Toggle verbose console debug logging for scanning and downloads"
            >
              <span className={`w-2 h-2 rounded-full ${debugLogging ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'}`}></span>
              <span>DEBUG {debugLogging ? 'ON' : 'OFF'}</span>
            </button>
          )}

          {!isExtension && (
            <button
              onClick={onDownloadZip}
              disabled={isDownloadingZip}
              className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 active:bg-cyan-500 rounded-lg transition-colors whitespace-nowrap shadow-sm disabled:opacity-50"
              title="Download complete unpacked Chrome Extension package as .zip"
            >
              <FolderArchive className="w-3.5 h-3.5" />
              <span>{isDownloadingZip ? 'Packing ZIP...' : 'Download Extension (.zip)'}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
