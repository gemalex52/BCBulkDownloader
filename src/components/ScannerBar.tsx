import React, { useState } from 'react';
import { Search, Loader2, Disc3, ShieldCheck, CheckSquare, Sparkles } from 'lucide-react';

interface ScannerBarProps {
  url: string;
  onUrlChange: (url: string) => void;
  onScan: () => void;
  onForceRefreshScan: () => void;
  isScanning: boolean;
  scanProgressText?: string;
  skipTrackSubpages: boolean;
  onToggleSkipTracks: (skip: boolean) => void;
  onLoadEsoctrilihum: () => void;
  isCached?: boolean;
  cacheTime?: string;
}

export const ScannerBar: React.FC<ScannerBarProps> = ({
  url,
  onUrlChange,
  onScan,
  onForceRefreshScan,
  isScanning,
  scanProgressText,
  skipTrackSubpages,
  onToggleSkipTracks,
  onLoadEsoctrilihum,
  isCached,
  cacheTime,
}) => {
  const [inputError, setInputError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setInputError('Please enter a valid Bandcamp artist URL.');
      return;
    }
    if (!url.includes('bandcamp.com')) {
      setInputError('URL must be on a *.bandcamp.com domain.');
      return;
    }
    setInputError(null);
    onScan();
  };

  return (
    <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 mb-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={url}
              onChange={(e) => {
                onUrlChange(e.target.value);
                if (inputError) setInputError(null);
              }}
              placeholder="https://esoctrilihum.bandcamp.com/music"
              className="w-full pl-10 pr-4 py-2.5 bg-[#0b0f17] border border-slate-700/80 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition"
              disabled={isScanning}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onLoadEsoctrilihum}
              disabled={isScanning}
              className="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-300 text-xs font-medium rounded-lg border border-slate-700 transition whitespace-nowrap"
              title="Reset URL to Esoctrilihum template page"
            >
              Esoctrilihum
            </button>

            <button
              type="button"
              onClick={onForceRefreshScan}
              disabled={isScanning}
              className="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-300 text-xs font-medium rounded-lg border border-slate-700 transition whitespace-nowrap"
              title="Force fresh scan ignoring cache"
            >
              ↺ Re-scan
            </button>

            <button
              type="submit"
              disabled={isScanning}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 active:bg-cyan-600 disabled:bg-slate-800 text-slate-950 disabled:text-slate-500 font-semibold text-xs rounded-lg transition whitespace-nowrap shadow-sm"
            >
              {isScanning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Scanning...</span>
                </>
              ) : (
                <>
                  <Disc3 className="w-4 h-4" />
                  <span>Scan Discography</span>
                </>
              )}
            </button>
          </div>
        </div>

        {inputError && (
          <p className="text-xs text-rose-400 font-medium">{inputError}</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-800 text-xs text-slate-400">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={skipTrackSubpages}
              onChange={(e) => onToggleSkipTracks(e.target.checked)}
              className="w-4 h-4 rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
            />
            <span className="text-slate-300 font-medium">
              Skip album track sub-pages
            </span>
            <span className="text-slate-500">
              (Crawls release albums without following individual tracklist sub-pages)
            </span>
          </label>

          {isScanning && scanProgressText && (
            <div className="flex items-center gap-2 text-cyan-400 font-mono text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
              <span>{scanProgressText}</span>
            </div>
          )}
        </div>
      </form>
    </div>
  );
};
