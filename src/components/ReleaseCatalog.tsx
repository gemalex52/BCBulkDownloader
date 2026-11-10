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
  onSetReleaseScope?: (id: string, scope: 'both' | 'audio' | 'info') => void;
  onSetBatchScope?: (scope: 'both' | 'audio' | 'info') => void;
  onResetReleaseState?: (releaseId: string) => void;
  onToggleGroupSelect?: (group: 'both' | 'audio' | 'info' | 'failed' | 'none') => void;
}

export function getReleaseBadgeInfo(r: ScannedRelease) {
  if (r.isPurchased || r.badgeType === 'own') {
    return {
      type: 'own' as const,
      label: 'Own',
      badgeClass: 'bg-purple-950/90 text-purple-300 border-purple-500/40',
      textClass: 'text-purple-400 font-semibold',
    };
  }

  // Strictly paid releases must never be converted to email
  if (r.badgeType === 'paid' || r.isPaid) {
    const cur = r.currency === 'EUR' ? '€' : (r.currency === 'USD' ? '$' : (r.currency === 'GBP' ? '£' : r.currency || '€'));
    const label = r.minPrice > 0 ? `Paid (${cur}${r.minPrice})` : (r.priceFormatted || 'Paid');
    return {
      type: 'paid' as const,
      label,
      badgeClass: 'bg-amber-950/90 text-amber-300 border-amber-500/40',
      textClass: 'text-amber-400 font-medium',
    };
  }

  const isEmail = r.badgeType === 'email' || r.requiresEmail || r.isNameYourPrice;
  const isDirectFree = r.badgeType === 'free' || (r.isFree && !isEmail);

  if (isDirectFree) {
    return {
      type: 'free' as const,
      label: 'Free',
      badgeClass: 'bg-emerald-950/90 text-emerald-300 border-emerald-500/40',
      textClass: 'text-emerald-400 font-medium',
    };
  }

  if (isEmail) {
    const cur = r.currency === 'EUR' ? '€' : (r.currency === 'USD' ? '$' : (r.currency === 'GBP' ? '£' : r.currency || '€'));
    const label = r.minPrice > 0 ? `Email (${cur}${r.minPrice})` : 'Email';
    return {
      type: 'email' as const,
      label,
      badgeClass: 'bg-cyan-950/90 text-cyan-300 border-cyan-500/40',
      textClass: 'text-cyan-400 font-medium',
    };
  }

  // Strictly paid fallback
  const cur = r.currency === 'EUR' ? '€' : (r.currency === 'USD' ? '$' : (r.currency === 'GBP' ? '£' : r.currency || '€'));
  const label = r.minPrice > 0 ? `Paid (${cur}${r.minPrice})` : (r.priceFormatted || 'Paid');
  return {
    type: 'paid' as const,
    label,
    badgeClass: 'bg-amber-950/90 text-amber-300 border-amber-500/40',
    textClass: 'text-amber-400 font-medium',
  };
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
  onSetReleaseScope,
  onSetBatchScope,
  onResetReleaseState,
  onToggleGroupSelect,
}) => {
  const [filterType, setFilterType] = useState<'all' | 'free' | 'email' | 'paid' | 'own'>('all');
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

    const badge = getReleaseBadgeInfo(r);
    if (filterType === 'free') return badge.type === 'free';
    if (filterType === 'email') return badge.type === 'email';
    if (filterType === 'paid') return badge.type === 'paid';
    if (filterType === 'own') return badge.type === 'own';
    return true;
  });

  const totalCount = releases.length;
  const ownCount = releases.filter((r) => getReleaseBadgeInfo(r).type === 'own').length;
  const freeCount = releases.filter((r) => getReleaseBadgeInfo(r).type === 'free').length;
  const emailCount = releases.filter((r) => getReleaseBadgeInfo(r).type === 'email').length;
  const paidCount = releases.filter((r) => getReleaseBadgeInfo(r).type === 'paid').length;
  const selectedCount = releases.filter((r) => r.selected).length;

  const allEligibleSelected =
    releases.length > 0 &&
    releases.filter((r) => getReleaseBadgeInfo(r).type !== 'paid').every((r) => r.selected);

  // Group status computation for selection toggles
  const bothDownloadedReleases = releases.filter((r) => {
    const q = queueItems?.[r.id];
    return Boolean((r.audioDownloaded || q?.audioDownloaded) && (r.infoZipDownloaded || q?.infoZipDownloaded));
  });
  const audioOnlyReleases = releases.filter((r) => {
    const q = queueItems?.[r.id];
    return Boolean((r.audioDownloaded || q?.audioDownloaded) && !(r.infoZipDownloaded || q?.infoZipDownloaded));
  });
  const infoOnlyReleases = releases.filter((r) => {
    const q = queueItems?.[r.id];
    return Boolean((r.infoZipDownloaded || q?.infoZipDownloaded) && !(r.audioDownloaded || q?.audioDownloaded));
  });
  const notDownloadedReleases = releases.filter((r) => {
    const q = queueItems?.[r.id];
    return !r.audioDownloaded && !q?.audioDownloaded && !r.infoZipDownloaded && !q?.infoZipDownloaded;
  });
  const failedReleases = releases.filter((r) => {
    const q = queueItems?.[r.id];
    return Boolean(q && (q.stage === 'failed' || Boolean(q.error) || (q.logs && q.logs.some((l) => Boolean(l.error)))));
  });

  const isBothSelected = bothDownloadedReleases.length > 0 && bothDownloadedReleases.every((r) => r.selected);
  const isAudioOnlySelected = audioOnlyReleases.length > 0 && audioOnlyReleases.every((r) => r.selected);
  const isInfoOnlySelected = infoOnlyReleases.length > 0 && infoOnlyReleases.every((r) => r.selected);
  const isFailedSelected = failedReleases.length > 0 && failedReleases.every((r) => r.selected);
  const isNotDlSelected = notDownloadedReleases.length > 0 && notDownloadedReleases.every((r) => r.selected);

  const renderStageBadge = (qItem?: QueueItem) => {
    if (!qItem || qItem.stage === 'pending') return null;

    switch (qItem.stage) {
      case 'completed': {
        if (qItem.audioDownloaded && qItem.infoZipDownloaded) {
          return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/80 border border-emerald-500/50 text-emerald-300">
              <CheckCircle2 className="w-3 h-3" />
              <span>Both Complete</span>
            </span>
          );
        }
        if (qItem.infoZipDownloaded && !qItem.audioDownloaded) {
          return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-950/80 border border-indigo-500/50 text-indigo-300">
              <FolderArchive className="w-3 h-3" />
              <span>{qItem.error ? 'Info OK (Audio Err)' : 'Info Complete'}</span>
            </span>
          );
        }
        if (qItem.audioDownloaded && !qItem.infoZipDownloaded) {
          return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-cyan-950/80 border border-cyan-500/50 text-cyan-300">
              <Music className="w-3 h-3" />
              <span>{qItem.error ? 'Audio OK (Info Err)' : 'Audio Complete'}</span>
            </span>
          );
        }
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/80 border border-emerald-500/50 text-emerald-300">
            <CheckCircle2 className="w-3 h-3" />
            <span>Completed</span>
          </span>
        );
      }
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
              <span>Select Free & Email ({freeCount + emailCount})</span>
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

            {/* State-Based Group Selection Toggles */}
            {onToggleGroupSelect && (
              <div className="flex flex-wrap items-center gap-1.5 pl-2 border-l border-slate-800">
                {bothDownloadedReleases.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onToggleGroupSelect('both')}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
                      isBothSelected
                        ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200'
                        : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700'
                    }`}
                    title="Toggle selection for releases with both audio & info downloaded"
                  >
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>Both ({bothDownloadedReleases.length})</span>
                  </button>
                )}
                {audioOnlyReleases.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onToggleGroupSelect('audio')}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
                      isAudioOnlySelected
                        ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200'
                        : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700'
                    }`}
                    title="Toggle selection for releases with audio only downloaded"
                  >
                    <Music className="w-3 h-3 text-cyan-400" />
                    <span>Audio ({audioOnlyReleases.length})</span>
                  </button>
                )}
                {infoOnlyReleases.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onToggleGroupSelect('info')}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
                      isInfoOnlySelected
                        ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200'
                        : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700'
                    }`}
                    title="Toggle selection for releases with info archive only downloaded"
                  >
                    <FolderArchive className="w-3 h-3 text-indigo-400" />
                    <span>Info ({infoOnlyReleases.length})</span>
                  </button>
                )}
                {notDownloadedReleases.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onToggleGroupSelect('none')}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
                      isNotDlSelected
                        ? 'bg-amber-950/80 border-amber-500 text-amber-200'
                        : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700'
                    }`}
                    title="Toggle selection for releases not yet downloaded"
                  >
                    <Square className="w-3 h-3 text-amber-400" />
                    <span>Not DL ({notDownloadedReleases.length})</span>
                  </button>
                )}
                {failedReleases.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onToggleGroupSelect('failed')}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
                      isFailedSelected
                        ? 'bg-rose-950/80 border-rose-500 text-rose-200'
                        : 'bg-slate-800/80 hover:bg-slate-700 text-rose-300 border-rose-900/60'
                    }`}
                    title="Toggle selection for releases that encountered download errors"
                  >
                    <AlertCircle className="w-3 h-3 text-rose-400" />
                    <span>Failed ({failedReleases.length})</span>
                  </button>
                )}
              </div>
            )}
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
          <div className="flex flex-wrap items-center gap-1.5">
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
              onClick={() => setFilterType('email')}
              className={`px-2.5 py-1 rounded-md transition ${
                filterType === 'email'
                  ? 'bg-cyan-950/70 border border-cyan-500/50 text-cyan-300 font-semibold'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              Email ({emailCount})
            </button>
            <button
              onClick={() => setFilterType('paid')}
              className={`px-2.5 py-1 rounded-md transition ${
                filterType === 'paid'
                  ? 'bg-amber-950/70 border border-amber-500/50 text-amber-300 font-semibold'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              Paid ({paidCount})
            </button>
            {ownCount > 0 && (
              <button
                onClick={() => setFilterType('own')}
                className={`px-2.5 py-1 rounded-md transition ${
                  filterType === 'own'
                    ? 'bg-purple-950/70 border border-purple-500/50 text-purple-300 font-semibold'
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                Own ({ownCount})
              </button>
            )}
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
                    {(() => {
                      const badge = getReleaseBadgeInfo(release);
                      return (
                        <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border backdrop-blur-sm ${badge.badgeClass}`}>
                          {badge.label}
                        </span>
                      );
                    })()}

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
                        {/* Monotonic Stage Progress Bar */}
                        <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden mt-2">
                          <div
                            className={`h-full transition-all duration-300 ${
                              qItem.stage === 'completed'
                                ? 'bg-emerald-400'
                                : qItem.stage === 'failed'
                                ? 'bg-red-400'
                                : 'bg-cyan-400'
                            }`}
                            style={{
                              width: `${
                                qItem.stage === 'completed' || qItem.stage === 'failed'
                                  ? 100
                                  : qItem.stage === 'pacing'
                                  ? 95
                                  : qItem.stage === 'packaging_info'
                                  ? 85
                                  : qItem.stage === 'downloading_audio'
                                  ? 70
                                  : qItem.stage === 'resolving_stat'
                                  ? 55
                                  : qItem.stage === 'polling_gas'
                                  ? 40
                                  : qItem.stage === 'triggering_email'
                                  ? 25
                                  : qItem.stage === 'checking_mail'
                                  ? 15
                                  : 10
                              }%`,
                            }}
                          />
                        </div>
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

                    {/* Download Target Scope Selector */}
                    <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                      <span className="text-slate-400 font-medium">Download:</span>
                      <div className="inline-flex items-center bg-[#0b0f17] border border-slate-700/80 rounded-lg p-0.5 text-[10px]">
                        <button
                          type="button"
                          onClick={() => onSetReleaseScope?.(release.id, 'both')}
                          className={`px-2 py-0.5 rounded transition ${
                            (release.downloadScope || 'both') === 'both'
                              ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                          title="Download studio audio + companion info ZIP"
                        >
                          Both
                        </button>
                        <button
                          type="button"
                          onClick={() => onSetReleaseScope?.(release.id, 'audio')}
                          className={`px-2 py-0.5 rounded transition ${
                            release.downloadScope === 'audio'
                              ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                          title="Download studio audio only (FLAC / MP3)"
                        >
                          Audio
                        </button>
                        <button
                          type="button"
                          onClick={() => onSetReleaseScope?.(release.id, 'info')}
                          className={`px-2 py-0.5 rounded transition ${
                            release.downloadScope === 'info'
                              ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                          title="Download companion info archive only (info.txt, cover, artist, photos, lyrics)"
                        >
                          Info
                        </button>
                      </div>
                    </div>
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

                      {onResetReleaseState && (release.audioDownloaded || release.infoZipDownloaded || qItem?.audioDownloaded || qItem?.infoZipDownloaded || qItem?.stage === 'completed' || qItem?.stage === 'failed') && (
                        <button
                          type="button"
                          onClick={() => onResetReleaseState(release.id)}
                          className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-amber-300 border border-slate-700 rounded transition"
                          title="Reset downloaded state for this release"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Reset</span>
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
                  <th className="p-3">Target</th>
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
                        {(() => {
                          const badge = getReleaseBadgeInfo(release);
                          return (
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border ${badge.badgeClass}`}>
                              {badge.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="p-3">
                        <div className="inline-flex items-center bg-[#0b0f17] border border-slate-700/80 rounded-lg p-0.5 text-[10px]">
                          <button
                            type="button"
                            onClick={() => onSetReleaseScope?.(release.id, 'both')}
                            className={`px-1.5 py-0.5 rounded transition ${
                              (release.downloadScope || 'both') === 'both'
                                ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                            title="Audio + Info"
                          >
                            Both
                          </button>
                          <button
                            type="button"
                            onClick={() => onSetReleaseScope?.(release.id, 'audio')}
                            className={`px-1.5 py-0.5 rounded transition ${
                              release.downloadScope === 'audio'
                                ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                            title="Audio only"
                          >
                            Audio
                          </button>
                          <button
                            type="button"
                            onClick={() => onSetReleaseScope?.(release.id, 'info')}
                            className={`px-1.5 py-0.5 rounded transition ${
                              release.downloadScope === 'info'
                                ? 'bg-cyan-500/20 text-cyan-300 font-semibold'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                            title="Info only"
                          >
                            Info
                          </button>
                        </div>
                      </td>
                      <td className="p-3">
                        {renderStageBadge(qItem) || <span className="text-slate-500">—</span>}
                        {qItem?.statusText && qItem.stage !== 'pending' && (
                          <div className="text-[10px] text-slate-400 truncate max-w-xs mt-0.5">
                            {qItem.statusText}
                          </div>
                        )}
                        {qItem && qItem.stage !== 'pending' && (
                          <div className="w-28 bg-slate-800 h-1 rounded-full overflow-hidden mt-1.5">
                            <div
                              className={`h-full transition-all duration-300 ${
                                qItem.stage === 'completed'
                                  ? 'bg-emerald-400'
                                  : qItem.stage === 'failed'
                                  ? 'bg-red-400'
                                  : 'bg-cyan-400'
                              }`}
                              style={{
                                width: `${
                                  qItem.stage === 'completed' || qItem.stage === 'failed'
                                    ? 100
                                    : qItem.stage === 'pacing'
                                    ? 95
                                    : qItem.stage === 'packaging_info'
                                    ? 85
                                    : qItem.stage === 'downloading_audio'
                                    ? 70
                                    : qItem.stage === 'resolving_stat'
                                    ? 55
                                    : qItem.stage === 'polling_gas'
                                    ? 40
                                    : qItem.stage === 'triggering_email'
                                    ? 25
                                    : qItem.stage === 'checking_mail'
                                    ? 15
                                    : 10
                                }%`,
                              }}
                            />
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
                        {onResetReleaseState && (release.audioDownloaded || release.infoZipDownloaded || qItem?.audioDownloaded || qItem?.infoZipDownloaded || qItem?.stage === 'completed' || qItem?.stage === 'failed') && (
                          <button
                            type="button"
                            onClick={() => onResetReleaseState(release.id)}
                            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-amber-300 border border-slate-700 rounded font-medium text-xs"
                            title="Reset download state"
                          >
                            Reset
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
