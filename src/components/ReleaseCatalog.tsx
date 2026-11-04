import React, { useState } from 'react';
import { QueueItem, ScannedRelease } from '../types/bandcamp';
import {
  CheckSquare,
  Square,
  ExternalLink,
  Music,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  List,
  Mail,
  AlertCircle,
  RotateCcw,
  CheckCircle2,
  Clock,
  Send,
  Loader2,
  FileText,
  FolderArchive,
} from 'lucide-react';

interface ReleaseCatalogProps {
  releases: ScannedRelease[];
  queueItems?: Record<string, QueueItem>;
  onToggleSelect: (id: string) => void;
  onSelectAllFreeAndNyp: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDownloadSingle: (release: ScannedRelease) => void;
  onRetryItem?: (releaseId: string) => void;
}

export const ReleaseCatalog: React.FC<ReleaseCatalogProps> = ({
  releases,
  queueItems,
  onToggleSelect,
  onSelectAllFreeAndNyp,
  onSelectAll,
  onDeselectAll,
  onDownloadSingle,
  onRetryItem,
}) => {
  const [filterType, setFilterType] = useState<'all' | 'free' | 'nyp' | 'paid'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [expandedTracklists, setExpandedTracklists] = useState<Record<string, boolean>>({});
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});

  const toggleTracklist = (id: string) => {
    setExpandedTracklists((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleLogs = (id: string) => {
    setExpandedLogs((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Filter releases
  const filteredReleases = releases.filter((r) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = r.title.toLowerCase().includes(q);
      const matchTags = r.tags?.some((t) => t.toLowerCase().includes(q));
      if (!matchTitle && !matchTags) return false;
    }

    if (filterType === 'free') return r.isFree && !r.isNameYourPrice;
    if (filterType === 'nyp') return r.isNameYourPrice;
    if (filterType === 'paid') return !r.isFree && !r.isNameYourPrice;
    return true;
  });

  const totalCount = releases.length;
  const freeCount = releases.filter((r) => r.isFree && !r.isNameYourPrice).length;
  const nypCount = releases.filter((r) => r.isNameYourPrice).length;
  const paidCount = releases.filter((r) => !r.isFree && !r.isNameYourPrice).length;
  const selectedCount = releases.filter((r) => r.selected).length;

  const allEligibleSelected =
    releases.length > 0 &&
    releases.filter((r) => r.isFree || r.isNameYourPrice).every((r) => r.selected);

  const renderStageBadge = (qItem?: QueueItem) => {
    if (!qItem || qItem.stage === 'pending') return null;

    switch (qItem.stage) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/80 border border-emerald-500/50 text-emerald-300">
            <CheckCircle2 className="w-3 h-3" />
            <span>Completed</span>
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-red-950/80 border border-red-500/50 text-red-300">
            <AlertCircle className="w-3 h-3" />
            <span>Failed</span>
          </span>
        );
      case 'checking_mail':
      case 'triggering_email':
      case 'polling_gas':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-950/80 border border-amber-500/50 text-amber-300 animate-pulse">
            <Mail className="w-3 h-3" />
            <span>
              {qItem.stage === 'polling_gas' ? 'Polling Mailbox' : 'Email Link Flow'}
            </span>
          </span>
        );
      case 'downloading_audio':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-cyan-950/80 border border-cyan-500/50 text-cyan-300 animate-pulse">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Downloading Audio</span>
          </span>
        );
      case 'packaging_info':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-950/80 border border-indigo-500/50 text-indigo-300 animate-pulse">
            <FolderArchive className="w-3 h-3" />
            <span>Building Info ZIP</span>
          </span>
        );
      case 'pacing':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-950/80 border border-blue-500/50 text-blue-300">
            <Clock className="w-3 h-3" />
            <span>Pacing Delay</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300">
            <Clock className="w-3 h-3" />
            <span>{qItem.stage}</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Metrics and Controls Toolbar */}
      <div className="bg-[#111827] border border-slate-800 rounded-xl p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Quick Selection Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onSelectAllFreeAndNyp}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-300 border border-cyan-800/60 rounded-lg text-xs font-semibold transition"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span>Select Free & NYP ({freeCount + nypCount})</span>
            </button>
            <button
              onClick={onSelectAll}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium border border-slate-700 transition"
            >
              Select All ({totalCount})
            </button>
            <button
              onClick={onDeselectAll}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 rounded-lg text-xs font-medium border border-slate-700 transition"
            >
              Deselect All
            </button>
          </div>

          {/* Search and View Mode Switch */}
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search albums..."
              className="w-48 sm:w-60 px-3 py-1.5 bg-[#0b0f17] border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
            />
            <div className="flex items-center bg-[#0b0f17] border border-slate-700 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded transition ${
                  viewMode === 'grid'
                    ? 'bg-slate-800 text-cyan-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Grid view"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded transition ${
                  viewMode === 'table'
                    ? 'bg-slate-800 text-cyan-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Table view"
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Filter Badges & Counter */}
        <div className="flex flex-wrap items-center justify-between gap-2 mt-4 pt-3 border-t border-slate-800 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-medium mr-1">Filter:</span>
            <button
              onClick={() => setFilterType('all')}
              className={`px-2.5 py-1 rounded-md transition ${
                filterType === 'all'
                  ? 'bg-slate-700 text-white font-semibold'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({totalCount})
            </button>
            <button
              onClick={() => setFilterType('free')}
              className={`px-2.5 py-1 rounded-md transition ${
                filterType === 'free'
                  ? 'bg-emerald-950/70 border border-emerald-500/50 text-emerald-300 font-semibold'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              Free ({freeCount})
            </button>
            <button
              onClick={() => setFilterType('nyp')}
              className={`px-2.5 py-1 rounded-md transition ${
                filterType === 'nyp'
                  ? 'bg-amber-950/70 border border-amber-500/50 text-amber-300 font-semibold'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              Name Your Price ({nypCount})
            </button>
            <button
              onClick={() => setFilterType('paid')}
              className={`px-2.5 py-1 rounded-md transition ${
                filterType === 'paid'
                  ? 'bg-slate-700 text-white font-semibold'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              Paid / Non-NYP ({paidCount})
            </button>
          </div>

          <div className="text-slate-400">
            Selected: <span className="font-semibold text-cyan-400 font-mono">{selectedCount}</span> of {totalCount}
          </div>
        </div>
      </div>

      {/* Grid View */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredReleases.map((release) => {
            const isExpanded = !!expandedTracklists[release.id];
            const isLogOpen = !!expandedLogs[release.id];
            const qItem = queueItems?.[release.id];

            return (
              <div
                key={release.id}
                className={`group relative flex flex-col bg-[#111827] border rounded-xl overflow-hidden transition-all duration-150 ${
                  release.selected
                    ? 'border-cyan-500/80 ring-1 ring-cyan-500/30 bg-[#121c2e]'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Artwork Area with Checkbox overlay */}
                <div className="relative aspect-square w-full bg-[#0b0f17] overflow-hidden">
                  {release.artUrl ? (
                    <img
                      src={release.artUrl}
                      alt={release.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      onError={(e) => {
                        (e.currentTarget as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : null}

                  {/* Fallback Artwork Container */}
                  <div
                    className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-gradient-to-br from-slate-900 to-slate-950 -z-10"
                    aria-hidden="true"
                  >
                    <Music className="w-10 h-10 text-slate-600 mb-2" />
                    <span className="text-xs text-slate-400 line-clamp-2">{release.title}</span>
                  </div>

                  {/* Checkbox Floating Button */}
                  <div className="absolute top-2.5 left-2.5 z-10">
                    <button
                      type="button"
                      onClick={() => onToggleSelect(release.id)}
                      className={`p-1.5 rounded-lg backdrop-blur-md transition ${
                        release.selected
                          ? 'bg-cyan-500 text-slate-950 shadow-md'
                          : 'bg-black/60 text-white/80 hover:text-white hover:bg-black/80'
                      }`}
                      title={release.selected ? 'Deselect release' : 'Select release'}
                    >
                      {release.selected ? (
                        <CheckSquare className="w-4 h-4" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  {/* Price Tag Overlay */}
                  <div className="absolute top-2.5 right-2.5 z-10 flex flex-col items-end gap-1">
                    {release.isPurchased ? (
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-cyan-950/90 text-cyan-300 border border-cyan-500/40 backdrop-blur-sm">
                        You Own It
                      </span>
                    ) : release.isFree && !release.isNameYourPrice ? (
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-950/90 text-emerald-300 border border-emerald-500/40 backdrop-blur-sm">
                        Free Download
                      </span>
                    ) : release.isNameYourPrice ? (
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-950/90 text-amber-300 border border-amber-500/40 backdrop-blur-sm">
                        Name Your Price ($0+)
                      </span>
                    ) : (
                      <span
                        className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-900/90 text-slate-400 border border-slate-700 backdrop-blur-sm"
                        title="Paid album: Audio skipped per policy unless owned. Hi-res artwork, liner notes, lyrics, and extra photos will be bundled."
                      >
                        {release.priceFormatted}
                      </span>
                    )}

                    {renderStageBadge(qItem)}
                  </div>
                </div>

                {/* Card Content */}
                <div className="p-4 flex-1 flex flex-col justify-between">
                  <div>
                    <h3
                      className="font-semibold text-white text-sm line-clamp-1 group-hover:text-cyan-400 transition"
                      title={release.title}
                    >
                      {release.title}
                    </h3>
                    
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-1">
                      <span>{release.artist}</span>
                      {release.releaseDate && (
                        <>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                          <span>{release.releaseDate.split(',')[1] || release.releaseDate}</span>
                        </>
                      )}
                      {release.trackCount ? (
                        <>
                          <span aria-hidden="true" className="text-slate-600">·</span>
                          <span className="font-mono tabular-nums">{release.trackCount} trk</span>
                        </>
                      ) : null}
                    </div>

                    {/* Email note if required */}
                    {release.requiresEmail && (
                      <div className="flex items-center gap-1.5 text-[11px] text-amber-400/90 mt-2">
                        <Mail className="w-3 h-3 shrink-0" />
                        <span>Requires email for $0 token</span>
                      </div>
                    )}

                    {/* Live queue status text */}
                    {qItem && qItem.statusText && qItem.stage !== 'pending' && (
                      <div className="mt-2 p-2 bg-[#0b0f17] rounded border border-slate-800 text-[11px]">
                        <div className="flex items-center justify-between text-slate-300">
                          <span className="truncate">{qItem.statusText}</span>
                          {qItem.logs && qItem.logs.length > 0 && (
                            <button
                              type="button"
                              onClick={() => toggleLogs(release.id)}
                              className="text-[10px] text-cyan-400 hover:underline shrink-0 ml-1.5"
                            >
                              {isLogOpen ? 'Hide Logs' : 'View Logs'}
                            </button>
                          )}
                        </div>
                        {qItem.error && (
                          <div className="text-red-400 text-[10px] mt-1 break-words">
                            Error: {qItem.error}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Logs Drawer */}
                    {isLogOpen && qItem?.logs && (
                      <div className="mt-2 p-2 bg-[#080c14] border border-slate-800 rounded font-mono text-[10px] max-h-28 overflow-y-auto space-y-1">
                        {qItem.logs.map((log, lIdx) => (
                          <div key={lIdx} className="text-slate-400">
                            <span className="text-slate-600">[{log.timestamp}]</span>{' '}
                            <span className={log.error ? 'text-red-400' : 'text-slate-300'}>{log.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions & Tracklist Accordion */}
                  <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
                    {release.trackList && release.trackList.length > 0 ? (
                      <button
                        onClick={() => toggleTracklist(release.id)}
                        className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition"
                      >
                        <span>Tracks</span>
                        {isExpanded ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                      </button>
                    ) : (
                      <div />
                    )}

                    <div className="flex items-center gap-2">
                      {qItem?.stage === 'failed' && onRetryItem && (
                        <button
                          type="button"
                          onClick={() => onRetryItem(release.id)}
                          className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold bg-red-950/60 hover:bg-red-900/60 text-red-300 border border-red-800 rounded transition"
                          title="Retry download"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Retry</span>
                        </button>
                      )}

                      <a
                        href={release.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 text-slate-400 hover:text-cyan-400 transition"
                        title="Open on Bandcamp"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      <button
                        onClick={() => onDownloadSingle(release)}
                        className="px-2.5 py-1 text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md transition"
                        title="Download this release"
                      >
                        Download
                      </button>
                    </div>
                  </div>

                  {/* Expanded Tracklist */}
                  {isExpanded && release.trackList && (
                    <div className="mt-3 pt-3 border-t border-slate-800/80 text-[11px] text-slate-300 font-mono space-y-1 max-h-36 overflow-y-auto">
                      {release.trackList.map((trk, i) => (
                        <div key={i} className="truncate text-slate-400 hover:text-slate-200">
                          {trk}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Dense Table View */}
      {viewMode === 'table' && filteredReleases.length > 0 && (
        <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300 border-collapse">
              <thead className="bg-[#0b0f17] text-slate-400 font-medium border-b border-slate-800">
                <tr>
                  <th className="p-3 w-10 text-center">
                    <button
                      onClick={allEligibleSelected ? onDeselectAll : onSelectAllFreeAndNyp}
                      className="text-slate-400 hover:text-white"
                    >
                      {allEligibleSelected ? (
                        <CheckSquare className="w-4 h-4 text-cyan-400" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                  <th className="p-3 w-14">Cover</th>
                  <th className="p-3">Title & Artist</th>
                  <th className="p-3">Pricing Status</th>
                  <th className="p-3">Queue Status</th>
                  <th className="p-3 text-right">Tracks</th>
                  <th className="p-3">Date</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filteredReleases.map((release) => {
                  const qItem = queueItems?.[release.id];
                  return (
                    <tr
                      key={release.id}
                      className={`hover:bg-slate-800/40 transition ${
                        release.selected ? 'bg-cyan-950/20' : ''
                      }`}
                    >
                      <td className="p-3 text-center">
                        <button
                          onClick={() => onToggleSelect(release.id)}
                          className={release.selected ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300'}
                        >
                          {release.selected ? (
                            <CheckSquare className="w-4 h-4" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                      <td className="p-3">
                        <div className="w-10 h-10 rounded bg-slate-900 overflow-hidden relative">
                          <img
                            src={release.artUrl}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.currentTarget as HTMLElement).style.display = 'none';
                            }}
                          />
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="font-semibold text-white">{release.title}</div>
                        <div className="text-slate-400 text-[11px]">{release.artist}</div>
                      </td>
                      <td className="p-3">
                        {release.isPurchased ? (
                          <span className="text-cyan-400 font-semibold">You Own It</span>
                        ) : release.isFree && !release.isNameYourPrice ? (
                          <span className="text-emerald-400 font-medium">Free Download</span>
                        ) : release.isNameYourPrice ? (
                          <span className="text-amber-400 font-medium">Name Your Price ($0+)</span>
                        ) : (
                          <span className="text-slate-400" title="Audio skipped unless owned">
                            {release.priceFormatted}
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        {renderStageBadge(qItem) || <span className="text-slate-500">—</span>}
                        {qItem?.statusText && qItem.stage !== 'pending' && (
                          <div className="text-[10px] text-slate-400 truncate max-w-xs mt-0.5">
                            {qItem.statusText}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-right font-mono tabular-nums text-slate-300">
                        {release.trackCount || 1}
                      </td>
                      <td className="p-3 text-slate-400 whitespace-nowrap">
                        {release.releaseDate || '—'}
                      </td>
                      <td className="p-3 text-right space-x-2 whitespace-nowrap">
                        {qItem?.stage === 'failed' && onRetryItem && (
                          <button
                            type="button"
                            onClick={() => onRetryItem(release.id)}
                            className="px-2 py-1 bg-red-950/60 hover:bg-red-900/60 text-red-300 border border-red-800 rounded font-medium text-xs"
                          >
                            Retry
                          </button>
                        )}
                        <a
                          href={release.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block p-1 text-slate-400 hover:text-cyan-400"
                          title="Open Bandcamp page"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        <button
                          onClick={() => onDownloadSingle(release)}
                          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium"
                        >
                          Download
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
