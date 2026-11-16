import React, { useState, useMemo } from 'react';
import { ScannedRelease } from '../types/bandcamp';
import {
  matchPastedListAgainstReleases,
  MatchedReleaseItem,
} from '../services/listMatcher';
import {
  X,
  ClipboardList,
  CheckCircle2,
  AlertCircle,
  FileText,
  Search,
  CheckSquare,
  Square,
  ArrowRight,
  Music,
  Trash2,
  Sparkles,
} from 'lucide-react';

interface ScanListModalProps {
  isOpen: boolean;
  onClose: () => void;
  releases: ScannedRelease[];
  onApplyMatches: (matchedReleaseIds: string[], alsoMarkInfoZip?: boolean) => void;
}

export const ScanListModal: React.FC<ScanListModalProps> = ({
  isOpen,
  onClose,
  releases,
  onApplyMatches,
}) => {
  const [inputText, setInputText] = useState('');
  const [viewStep, setViewStep] = useState<'input' | 'preview'>('input');
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<string>>(new Set());
  const [alsoMarkInfoZip, setAlsoMarkInfoZip] = useState(false);

  // Compute matches
  const matchResult = useMemo(() => {
    return matchPastedListAgainstReleases(inputText, releases);
  }, [inputText, releases]);

  // Keep selectedMatchIds in sync when matches change
  React.useEffect(() => {
    const allIds = new Set(matchResult.matches.map((m) => m.release.id));
    setSelectedMatchIds(allIds);
  }, [matchResult.matches]);

  if (!isOpen) return null;

  const handleToggleMatch = (id: string) => {
    setSelectedMatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAllMatches = () => {
    setSelectedMatchIds(new Set(matchResult.matches.map((m) => m.release.id)));
  };

  const handleDeselectAllMatches = () => {
    setSelectedMatchIds(new Set());
  };

  const handleApply = () => {
    const idsToApply = Array.from(selectedMatchIds);
    if (idsToApply.length === 0) return;
    onApplyMatches(idsToApply, alsoMarkInfoZip);
    onClose();
  };

  const handleLoadSample = () => {
    if (releases.length === 0) {
      setInputText(
        `Esoctrilihum - 2020.10.31 - F'htansg.zip\n` +
        `Esoctrilihum - 2017.05.05 - Mystic Echo from a Funeral Dimension\n` +
        `Hedonist - 2024 - Scapulimancy\n` +
        `Floating - Firewatching`
      );
      return;
    }
    // Generate realistic sample matching some releases in the current catalog
    const samples = releases.slice(0, Math.min(releases.length, 5)).map((r) => {
      const datePart = r.isoDate || (r.releaseDate ? r.releaseDate.replace(/\./g, '.') : '2024.01.01');
      return `${r.artist} - ${datePart} - ${r.title}.zip`;
    });
    setInputText(samples.join('\n'));
  };

  const lineCount = inputText ? inputText.split(/\r?\n/).filter((l) => l.trim()).length : 0;
  const matchCount = matchResult.matches.length;
  const selectedCount = selectedMatchIds.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#0f172a] border border-slate-700/80 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#111c33]/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <ClipboardList className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <span>Scan Downloaded List</span>
                <span className="px-2 py-0.5 text-[11px] font-mono font-medium rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                  {releases.length} releases in catalog
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Paste a list of already downloaded files to de-select them and mark them as Audio Downloaded.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Step Tabs */}
        <div className="flex items-center gap-2 px-6 pt-3 pb-2 border-b border-slate-800/80 bg-[#0d1424] text-xs">
          <button
            onClick={() => setViewStep('input')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition ${
              viewStep === 'input'
                ? 'bg-slate-800 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>1. Paste List ({lineCount} lines)</span>
          </button>
          <button
            onClick={() => setViewStep('preview')}
            disabled={matchCount === 0}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition ${
              viewStep === 'preview'
                ? 'bg-slate-800 text-cyan-300 border border-cyan-500/40'
                : matchCount > 0
                ? 'text-cyan-400 hover:text-cyan-300 hover:bg-slate-800/50'
                : 'text-slate-600 cursor-not-allowed'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            <span>2. Preview Matches ({matchCount})</span>
            {matchCount > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-cyan-500/20 text-cyan-300 text-[10px] rounded-full font-bold">
                {matchCount}
              </span>
            )}
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {viewStep === 'input' ? (
            <div className="space-y-4">
              <div className="bg-[#131f37]/50 border border-slate-800 rounded-xl p-3.5 text-xs text-slate-300 flex items-start gap-2.5">
                <Sparkles className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-cyan-300">Supported format rough pattern:</p>
                  <p className="font-mono text-slate-300 bg-slate-900/80 px-2 py-1 rounded border border-slate-800 inline-block">
                    %artist% - [%date% - ]%album%
                  </p>
                  <p className="text-slate-400 text-[11px]">
                    The portion in <code className="text-cyan-300 font-mono">[]</code> is optional. Also strips file extensions (<code>.zip</code>, <code>.flac</code>, <code>.mp3</code>), folder paths, and numbering automatically.
                  </p>
                </div>
              </div>

              {/* Text Area */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <label htmlFor="pasted-list" className="font-medium text-slate-300">
                    Paste file list below:
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleLoadSample}
                      className="text-[11px] text-cyan-400 hover:text-cyan-300 transition hover:underline"
                    >
                      Fill sample
                    </button>
                    {inputText && (
                      <button
                        type="button"
                        onClick={() => setInputText('')}
                        className="text-[11px] text-slate-500 hover:text-rose-400 transition flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Clear</span>
                      </button>
                    )}
                  </div>
                </div>

                <textarea
                  id="pasted-list"
                  rows={12}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={`Esoctrilihum - 2020.10.31 - F'htansg.zip\nEsoctrilihum - 2017.05.05 - Mystic Echo from a Funeral Dimension\nHedonist - 2024 - Scapulimancy\nFloating - Firewatching`}
                  className="w-full px-4 py-3 bg-[#080d1a] border border-slate-800 rounded-xl text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition resize-y"
                />
              </div>

              {/* Realtime Detection Banner */}
              {lineCount > 0 && (
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/90 border border-slate-800 text-xs">
                  <div className="flex items-center gap-2 text-slate-300">
                    <CheckCircle2 className="w-4 h-4 text-cyan-400" />
                    <span>
                      Detected <strong className="text-white">{lineCount}</strong> lines. Found{' '}
                      <strong className="text-cyan-400">{matchCount} matching releases</strong> on this page.
                    </span>
                  </div>
                  {matchCount > 0 ? (
                    <button
                      onClick={() => setViewStep('preview')}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold rounded-lg text-xs transition shadow-sm"
                    >
                      <span>Preview Matches</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <span className="text-amber-400 text-[11px] font-medium flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>No matches found for current artist yet</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Preview Step */
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-cyan-950/30 border border-cyan-800/40 text-xs">
                <div>
                  <div className="font-semibold text-cyan-200">
                    Found {matchCount} matching releases in catalog
                  </div>
                  <div className="text-slate-400 text-[11px]">
                    Selected releases will be de-selected from download queue and marked as Audio Downloaded.
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAllMatches}
                    className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs transition border border-slate-700"
                  >
                    <CheckSquare className="w-3 h-3" />
                    <span>Select All ({matchCount})</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDeselectAllMatches}
                    className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded text-xs transition border border-slate-700"
                  >
                    <Square className="w-3 h-3" />
                    <span>Deselect All</span>
                  </button>
                </div>
              </div>

              {/* Matched Releases List */}
              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                {matchResult.matches.map(({ release, matchedLine, reason, matchType }) => {
                  const isChecked = selectedMatchIds.has(release.id);
                  return (
                    <div
                      key={release.id}
                      onClick={() => handleToggleMatch(release.id)}
                      className={`flex items-start gap-3 p-3 rounded-xl border transition cursor-pointer select-none ${
                        isChecked
                          ? 'bg-slate-900/90 border-cyan-500/50 shadow-sm'
                          : 'bg-[#0d1424]/60 border-slate-800 opacity-60 hover:opacity-90'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleMatch(release.id)}
                        className="w-4 h-4 mt-1 rounded bg-slate-800 border-slate-700 text-cyan-500 focus:ring-0 cursor-pointer"
                        onClick={(e) => e.stopPropagation()}
                      />

                      {release.artUrl ? (
                        <img
                          src={release.artUrl}
                          alt={release.title}
                          className="w-12 h-12 rounded-lg object-cover bg-slate-800 border border-slate-700 shrink-0"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-500 shrink-0">
                          <Music className="w-5 h-5" />
                        </div>
                      )}

                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-semibold text-white text-xs truncate">
                            {release.title}
                          </div>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                              matchType === 'exact'
                                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                                : 'bg-cyan-950/80 text-cyan-300 border-cyan-500/40'
                            }`}
                          >
                            {matchType === 'exact' ? 'Exact Match' : 'Title Matched'}
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-400 truncate">
                          {release.artist} {release.releaseDate ? `· ${release.releaseDate}` : ''}
                        </div>

                        <div className="text-[11px] font-mono text-cyan-400/90 truncate bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800">
                          Matched Line: {matchedLine}
                        </div>
                      </div>

                      <div className="text-right shrink-0 space-y-1 hidden sm:block">
                        <div className="text-[11px] font-medium text-amber-400/90">
                          De-select from queue
                        </div>
                        <div className="text-[10px] text-emerald-400 flex items-center justify-end gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Mark Audio Downloaded</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Extra Option: Also Mark Info ZIP */}
              <div className="pt-2 border-t border-slate-800">
                <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-400 hover:text-slate-300">
                  <input
                    type="checkbox"
                    checked={alsoMarkInfoZip}
                    onChange={(e) => setAlsoMarkInfoZip(e.target.checked)}
                    className="w-3.5 h-3.5 rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0 cursor-pointer"
                  />
                  <span>Also mark companion Info ZIP as downloaded for matched releases</span>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-[#111c33]/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium border border-slate-700 transition"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            {viewStep === 'preview' && (
              <button
                type="button"
                onClick={() => setViewStep('input')}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium border border-slate-700 transition"
              >
                Back to Edit
              </button>
            )}

            {viewStep === 'input' ? (
              <button
                type="button"
                onClick={() => setViewStep('preview')}
                disabled={matchCount === 0}
                className="flex items-center gap-2 px-5 py-2 bg-cyan-500 hover:bg-cyan-400 active:bg-cyan-600 disabled:bg-slate-800 text-slate-950 disabled:text-slate-500 font-semibold text-xs rounded-lg transition shadow-sm"
              >
                <span>Preview Matches ({matchCount})</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleApply}
                disabled={selectedCount === 0}
                className="flex items-center gap-2 px-5 py-2 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 disabled:bg-slate-800 text-slate-950 disabled:text-slate-500 font-semibold text-xs rounded-lg transition shadow-sm"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  Apply: De-select & Mark {selectedCount} Release{selectedCount === 1 ? '' : 's'}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
