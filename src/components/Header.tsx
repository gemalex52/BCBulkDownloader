import React from 'react';
import { Download, Sparkles, FolderArchive } from 'lucide-react';

interface HeaderProps {
  currentTab: 'scanner' | 'extension' | 'guide' | 'settings';
  onSelectTab: (tab: 'scanner' | 'extension' | 'guide' | 'settings') => void;
  onDownloadZip: () => void;
  isDownloadingZip?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onSelectTab,
  onDownloadZip,
  isDownloadingZip = false,
}) => {
  return (
    <header className="border-b border-slate-800 bg-[#0d131f] sticky top-0 z-40 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Brand title, one line text element */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M0 18.75l7.437-13.5h16.563l-7.438 13.5z" />
            </svg>
          </div>
          <span className="text-base font-bold tracking-tight text-white whitespace-nowrap">
            Bandcamp Bulk Downloader
          </span>
        </div>

        {/* Zone 2: 4 nav links, 1-2 word labels, single-line */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          <button
            onClick={() => onSelectTab('scanner')}
            className={`whitespace-nowrap transition-colors py-1 ${
              currentTab === 'scanner'
                ? 'text-cyan-400 border-b-2 border-cyan-400 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Live Scanner
          </button>
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

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={onDownloadZip}
            disabled={isDownloadingZip}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 active:bg-cyan-500 rounded-lg transition-colors whitespace-nowrap shadow-sm disabled:opacity-50"
            title="Download complete unpacked Chrome Extension package as .zip"
          >
            <FolderArchive className="w-3.5 h-3.5" />
            <span>{isDownloadingZip ? 'Packing ZIP...' : 'Download Extension (.zip)'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
