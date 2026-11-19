import React, { useState } from 'react';
import {
  AUDIO_FORMATS,
  DeliveryMode,
  DownloadTask,
  QueueItem,
  ScannedRelease,
  formatFilenameBySchema,
} from '../types/bandcamp';
import {
  Download,
  FolderArchive,
  Layers,
  FileCode,
  CheckCircle2,
  X,
  RotateCw,
  FileText,
  Play,
  RotateCcw,
  Square,
  Clock,
  Mail,
  Shield,
  AlertTriangle,
} from 'lucide-react';

interface DownloadManagerProps {
  selectedReleases: ScannedRelease[];
  selectedFormat: string;
  onFormatChange: (fmt: string) => void;
  deliveryMode: DeliveryMode;
  onDeliveryModeChange: (mode: DeliveryMode) => void;
  fallbackEmail: string;
  onFallbackEmailChange: (email: string) => void;
  namingSchema: string;
  onNamingSchemaChange: (schema: string) => void;
  infoZipNamingSchema?: string;
  onInfoZipNamingSchemaChange?: (schema: string) => void;
  onSetBatchScope?: (scope: 'both' | 'audio' | 'info') => void;
  onStartBulkDownload: () => void;
  onResumeBulkDownload?: () => void;
  canResume?: boolean;
  pendingCount?: number;
  failedCount?: number;
  completedCount?: number;
  isDownloading: boolean;
  downloadTasks: DownloadTask[];
  onCancelDownload: () => void;
  onResetAllState?: () => void;
  onRetryTask: (taskId: string) => void;
  activePacingNotice?: string;
  createCompanionInfoZip?: boolean;
  mailFilterType: 'no_offset' | 'offset_hours' | 'start_date';
  mailOffsetHours: number;
  mailStartDate: string;
  onMailOffsetChange: (updates: {
    gasSearchFilterType: 'no_offset' | 'offset_hours' | 'start_date';
    gasSearchOffsetHours?: number;
    gasSearchStartDate?: string;
  }) => void;
}

export const DownloadManager: React.FC<DownloadManagerProps> = ({
  selectedReleases,
  selectedFormat,
  onFormatChange,
  deliveryMode,
  onDeliveryModeChange,
  namingSchema,
  onNamingSchemaChange,
  infoZipNamingSchema,
  onInfoZipNamingSchemaChange,
  onSetBatchScope,
  onStartBulkDownload,
  onResumeBulkDownload,
  canResume = false,
  pendingCount = 0,
  failedCount = 0,
  completedCount = 0,
  isDownloading,
  downloadTasks,
  onCancelDownload,
  onResetAllState,
  onRetryTask,
  activePacingNotice,
  createCompanionInfoZip = true,
  mailFilterType,
  mailOffsetHours,
  mailStartDate,
  onMailOffsetChange,
}) => {
  const [showQueueModal, setShowQueueModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showSchemaPopover, setShowSchemaPopover] = useState(false);

  const selectedCount = selectedReleases.length;
  const currentFormatObj = AUDIO_FORMATS.find((f) => f.id === selectedFormat) || AUDIO_FORMATS[0];
  const requiresEmailCount = selectedReleases.filter((r) => r.requiresEmail).length;

  const totalTracks = selectedReleases.reduce((acc, r) => acc + (r.trackCount || 1), 0);
  const estimatedSizeMb = Math.round(totalTracks * currentFormatObj.approxMbPerTrack);

  const generateExportText = () => {
    let script = `# Bandcamp Bulk Download Links (${selectedFormat.toUpperCase()})\n`;
    script += `# Generated: ${new Date().toISOString()}\n`;
    script += `# Releases: ${selectedCount} (${totalTracks} tracks)\n\n`;

    selectedReleases.forEach((r, idx) => {
      script += `# [${idx + 1}/${selectedCount}] ${r.title} - ${r.artist} (${r.isoDate || r.releaseDate || 'N/A'})\n`;
      script += `${r.url}#download\n\n`;
    });
    return script;
  };

  const handleDownloadExportTxt = () => {
    const text = generateExportText();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bandcamp-download-links-${selectedFormat}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalTaskCount = downloadTasks.length || (pendingCount + completedCount + failedCount);
  const aggregatedTaskProgress =
    downloadTasks.length > 0
      ? downloadTasks.reduce((sum, t) => sum + (t.progress || 0), 0) / downloadTasks.length
      : completedCount * 100;
  const overallProgress =
    totalTaskCount > 0
      ? Math.min(100, Math.round(aggregatedTaskProgress))
      : 0;

  if (selectedCount === 0 && !isDownloading && totalTaskCount === 0) {
    return null;
  }

  const sampleRelease = selectedReleases[0] || {
    artist: 'Esoctrilihum',
    title: 'Almost Dead',
    releaseDate: 'October 31, 2025',
    isoDate: '2025.10.31',
    trackCount: 1,
    itemType: 'track',
  };

  return (
    <>
      {/* Floating Bottom Action Bar */}
      <div className="fixed bottom-0 inset-x-0 z-30 bg-[#0d131f]/95 backdrop-blur-md border-t border-slate-800 p-4 shadow-2xl transition-all">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Left summary */}
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shrink-0">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white flex items-center gap-2">
                <span>{selectedCount} Releases Selected</span>
                <span className="text-slate-500 text-xs font-mono font-normal">
                  (~{totalTracks} tracks · est. {estimatedSizeMb > 1000 ? `${(estimatedSizeMb / 1024).toFixed(1)} GB` : `${estimatedSizeMb} MB`})
                </span>
              </div>
              <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                <span>
                  {createCompanionInfoZip ? 'Studio Audio + Companion (info).zip' : 'Studio Audio Only'}
                </span>
                {activePacingNotice && (
                  <>
                    <span className="text-slate-600">·</span>
                    <span className="text-cyan-400 font-mono text-[11px] animate-pulse">
                      {activePacingNotice}
                    </span>
                  </>
                )}
                {requiresEmailCount > 0 && !activePacingNotice && (
                  <>
                    <span className="text-slate-600">·</span>
                    <span className="text-amber-400">{requiresEmailCount} require email link flow</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Controls: Format Selector, Meta Fields & Action Buttons */}
          <div className="flex flex-col items-end gap-2 w-full md:w-auto">
            <div className="flex flex-wrap items-center justify-end gap-3 w-full">
              {/* Format Dropdown */}
              <div className="flex items-center gap-1.5 bg-[#111827] border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs">
              <span className="text-slate-400 font-medium">Format:</span>
              <select
                value={selectedFormat}
                onChange={(e) => onFormatChange(e.target.value)}
                className="bg-transparent text-cyan-300 font-semibold focus:outline-none cursor-pointer"
              >
                {AUDIO_FORMATS.map((fmt) => (
                  <option key={fmt.id} value={fmt.id} className="bg-[#111827] text-white">
                    {fmt.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Naming Schema Popover Button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowSchemaPopover(!showSchemaPopover)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition ${
                  showSchemaPopover
                    ? 'bg-cyan-950 border-cyan-500 text-cyan-300'
                    : 'bg-[#111827] border-slate-700 text-slate-300 hover:text-white'
                }`}
                title="Customize output file naming schema"
              >
                <FileText className="w-3.5 h-3.5 text-cyan-400" />
                <span className="font-mono text-[11px]">%meta%</span>
              </button>

              {showSchemaPopover && (
                <div className="absolute bottom-full mb-2 right-0 w-80 sm:w-96 bg-[#111827] border border-slate-700 rounded-xl p-4 shadow-2xl z-50 text-xs">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                    <span className="font-semibold text-white">File Naming Schema (%meta_field%)</span>
                    <button
                      type="button"
                      onClick={() => setShowSchemaPopover(false)}
                      className="text-slate-400 hover:text-white"
                    >
                      ✕
                    </button>
                  </div>

                  <input
                    type="text"
                    value={namingSchema}
                    onChange={(e) => onNamingSchemaChange(e.target.value)}
                    placeholder="%artist% - %date% - %album%[%title%.%format%]"
                    className="w-full px-3 py-1.5 bg-[#0b0f17] border border-slate-700 rounded-lg text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-400"
                  />

                  <div className="flex flex-wrap gap-1 mt-2">
                    {[
                      { t: '%artist%', label: 'artist' },
                      { t: '%date%', label: 'date' },
                      { t: '%album%', label: 'album' },
                      { t: '%track_num%', label: 'track#' },
                      { t: '%title%', label: 'title' },
                      { t: '%format%', label: 'format' },
                    ].map((tag) => (
                      <button
                        key={tag.t}
                        type="button"
                        onClick={() => onNamingSchemaChange(`${namingSchema} ${tag.t}`)}
                        className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-white rounded border border-slate-700 text-[10px] font-mono"
                      >
                        +{tag.label}
                      </button>
                    ))}
                  </div>

                  <div className="mt-2 text-[10px] text-slate-400 font-mono truncate">
                    Preview:{' '}
                    <span className="text-emerald-400">
                      {formatFilenameBySchema(
                        namingSchema,
                        {
                          artist: sampleRelease.artist,
                          album: sampleRelease.title,
                          title: sampleRelease.title,
                          trackNum: 1,
                          totalTracks: sampleRelease.trackCount || 1,
                          date: sampleRelease.isoDate || sampleRelease.releaseDate,
                          format: selectedFormat,
                          type: sampleRelease.itemType || 'track',
                        }
                      )}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Export Links Button */}
            <button
              onClick={() => setShowExportModal(true)}
              className="p-2 text-slate-400 hover:text-white bg-[#111827] border border-slate-700 rounded-lg transition"
              title="Export download links as TXT / cURL"
            >
              <FileCode className="w-4 h-4" />
            </button>

            {/* Primary Action Button (Dynamic Resume vs Start with Stop and Start Over controls) */}
            {isDownloading ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowQueueModal(true)}
                  className="flex items-center gap-2 px-4 py-2.5 bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-bold rounded-lg transition shadow-md"
                >
                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                  <span>
                    Processing ({completedCount}/{totalTaskCount} · {overallProgress}%)
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onCancelDownload}
                  className="flex items-center gap-1.5 px-3 py-2.5 bg-red-950/80 hover:bg-red-900 border border-red-500/60 text-red-300 hover:text-white text-xs font-bold rounded-lg transition shadow-md"
                  title="Stop and cancel active download queue"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop</span>
                </button>
              </div>
            ) : canResume && onResumeBulkDownload ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    onResumeBulkDownload();
                    setShowQueueModal(true);
                  }}
                  className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg transition shadow-md"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>
                    Resume Download ({pendingCount + failedCount} remaining)
                  </span>
                </button>
                <button
                  onClick={() => {
                    onStartBulkDownload();
                    setShowQueueModal(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold rounded-lg transition border border-slate-700"
                  title="Restart all items from the beginning"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Start Fresh</span>
                </button>
                {onResetAllState && (
                  <button
                    onClick={onResetAllState}
                    className="flex items-center gap-1.5 px-3 py-2.5 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white text-xs font-medium rounded-lg transition border border-slate-700"
                    title="Reset all download flags and clear queue state"
                  >
                    <span>Start Over</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    onStartBulkDownload();
                    setShowQueueModal(true);
                  }}
                  disabled={selectedCount === 0}
                  className="flex items-center gap-2 px-5 py-2.5 bg-cyan-400 hover:bg-cyan-300 active:bg-cyan-500 disabled:opacity-50 text-slate-950 text-xs font-bold rounded-lg transition shadow-md"
                >
                  <Download className="w-4 h-4" />
                  <span>Start Download ({selectedCount})</span>
                </button>
                {onResetAllState && (completedCount > 0 || failedCount > 0) && (
                  <button
                    onClick={onResetAllState}
                    className="flex items-center gap-1.5 px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-xs font-medium rounded-lg transition border border-slate-700"
                    title="Reset all download flags and clear queue state"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Start Over</span>
                  </button>
                )}
              </div>
            )}
            </div>

            {/* Mail offset & Target selector for selected - placed in sticky lower footer */}
            <div className="flex flex-wrap items-center justify-end gap-3 mt-0.5">
              {/* Mail Offset Selector */}
              <div className="flex items-center gap-1.5 bg-[#111827] border border-slate-700 rounded-lg px-2.5 py-1 text-xs">
                <Mail className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="text-slate-400 font-medium">Mail offset:</span>
                <select
                  value={
                    mailFilterType === 'no_offset'
                      ? 'no_offset'
                      : mailFilterType === 'start_date'
                      ? 'custom'
                      : String(mailOffsetHours || 72)
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'no_offset') {
                      onMailOffsetChange({ gasSearchFilterType: 'no_offset' });
                    } else if (val === 'custom') {
                      onMailOffsetChange({
                        gasSearchFilterType: 'start_date',
                        gasSearchStartDate:
                          mailStartDate || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
                      });
                    } else {
                      onMailOffsetChange({
                        gasSearchFilterType: 'offset_hours',
                        gasSearchOffsetHours: parseFloat(val),
                      });
                    }
                  }}
                  className="bg-transparent text-amber-300 font-semibold focus:outline-none cursor-pointer"
                  title="Initial batch mail search window before triggering emails ('No offset' skips initial full-batch lookup and tracks exact trigger timestamps per item)"
                >
                  <option value="no_offset" className="bg-[#111827] text-white">No offset</option>
                  <option value="0.25" className="bg-[#111827] text-white">Last 15 min</option>
                  <option value="1" className="bg-[#111827] text-white">Last 1 Hour</option>
                  <option value="6" className="bg-[#111827] text-white">Last 6 Hours</option>
                  <option value="24" className="bg-[#111827] text-white">Last 24 Hours</option>
                  <option value="72" className="bg-[#111827] text-white">Last 3 Days</option>
                  <option value="168" className="bg-[#111827] text-white">Last 7 Days</option>
                  <option value="720" className="bg-[#111827] text-white">Last 30 Days</option>
                  <option value="custom" className="bg-[#111827] text-white">Custom Date...</option>
                </select>
                {mailFilterType === 'start_date' && (
                  <input
                    type="date"
                    value={mailStartDate || ''}
                    onChange={(e) =>
                      onMailOffsetChange({
                        gasSearchFilterType: 'start_date',
                        gasSearchStartDate: e.target.value,
                      })
                    }
                    className="ml-1 px-1.5 py-0.5 bg-[#0b0f17] border border-slate-700 rounded text-[11px] font-mono text-amber-300 focus:outline-none focus:border-amber-400"
                  />
                )}
              </div>

              {selectedCount > 0 && onSetBatchScope && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-400 font-medium">Target for selected:</span>
                  <div className="inline-flex items-center bg-[#111827] border border-slate-700 rounded-lg p-0.5 text-xs shadow-inner">
                    <button
                      type="button"
                      onClick={() => onSetBatchScope('both')}
                      className="px-2.5 py-1 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 text-xs font-medium transition"
                      title="Set selected to download both audio and companion info archive"
                    >
                      Both
                    </button>
                    <button
                      type="button"
                      onClick={() => onSetBatchScope('audio')}
                      className="px-2.5 py-1 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 text-xs font-medium transition"
                      title="Set selected to download studio audio only"
                    >
                      Audio only
                    </button>
                    <button
                      type="button"
                      onClick={() => onSetBatchScope('info')}
                      className="px-2.5 py-1 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 text-xs font-medium transition"
                      title="Set selected to download companion info archive only"
                    >
                      Info only
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Queue & Progress Modal */}
      {showQueueModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#111827] border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-base">Bulk Download Queue</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Format: {currentFormatObj.name} · Output: Studio Audio + Companion (info).zip
                </p>
              </div>
              <button
                onClick={() => setShowQueueModal(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Overall Progress Banner */}
            <div className="px-5 py-3 bg-[#0d131f] border-b border-slate-800 space-y-2 text-xs font-mono">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-slate-400">Total Progress:</span>
                  <span className="text-cyan-400 font-semibold">{overallProgress}%</span>
                  <span className="text-slate-500">
                    ({completedCount}/{totalTaskCount} completed
                    {failedCount > 0 ? `, ${failedCount} failed` : ''}
                    {pendingCount > 0 && isDownloading ? `, ${pendingCount} remaining` : ''})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {isDownloading ? (
                    <button
                      onClick={onCancelDownload}
                      className="flex items-center gap-1 px-2.5 py-1 bg-red-950/80 hover:bg-red-900 border border-red-500/50 text-red-300 rounded font-sans text-xs font-semibold transition"
                    >
                      <Square className="w-3 h-3 fill-current" />
                      <span>Stop Queue</span>
                    </button>
                  ) : onResetAllState && (completedCount > 0 || failedCount > 0) ? (
                    <button
                      onClick={onResetAllState}
                      className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-sans text-xs font-medium border border-slate-700 transition"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Start Over</span>
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="w-full bg-slate-800/90 h-2 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    failedCount > 0 && completedCount + failedCount === totalTaskCount
                      ? 'bg-amber-400'
                      : overallProgress === 100
                      ? 'bg-emerald-400'
                      : 'bg-cyan-400'
                  }`}
                  style={{ width: `${overallProgress}%` }}
                />
              </div>
              {activePacingNotice && (
                <div className="text-[11px] text-cyan-400 font-mono truncate">
                  {activePacingNotice}
                </div>
              )}
            </div>

            {/* Task List */}
            <div className="p-5 overflow-y-auto flex-1 space-y-3">
              {downloadTasks.length === 0 ? (
                <div className="py-8 text-center text-slate-500 text-xs">
                  No downloads currently in queue.
                </div>
              ) : (
                downloadTasks.map((task) => {
                  const stageOrder: Record<string, number> = {
                    pending: 0,
                    checking_mail: 1,
                    triggering_email: 1,
                    polling_gas: 1,
                    resolving_stat: 2,
                    downloading_audio: 3,
                    packaging_info: 4,
                    pacing: 5,
                    completed: 5,
                    skipped: 5,
                    failed: 5,
                  };
                  const currentStepIdx = stageOrder[task.stage || 'pending'] ?? 0;
                  const steps = ['Mail', 'Resolve', 'Audio', 'Info', 'Done'];

                  return (
                    <div
                      key={task.id}
                      className="p-3 bg-[#0d131f] border border-slate-800 rounded-xl space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          {task.status === 'completed' ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          ) : task.status === 'error' ? (
                            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                          ) : task.stage === 'checking_mail' || task.stage === 'triggering_email' || task.stage === 'polling_gas' ? (
                            <Mail className="w-4 h-4 text-amber-400 animate-pulse shrink-0" />
                          ) : task.stage === 'packaging_info' ? (
                            <FolderArchive className="w-4 h-4 text-indigo-400 animate-pulse shrink-0" />
                          ) : task.stage === 'pacing' ? (
                            <Clock className="w-4 h-4 text-sky-400 animate-pulse shrink-0" />
                          ) : task.status === 'queued' ? (
                            <Clock className="w-4 h-4 text-slate-500 shrink-0" />
                          ) : (
                            <RotateCw className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />
                          )}
                          <span className="font-semibold text-white truncate">{task.releaseTitle}</span>
                          <span className="text-slate-500 text-[11px] truncate">· {task.artist}</span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {task.status === 'error' && (
                            <button
                              onClick={() => onRetryTask(task.id)}
                              className="text-xs text-cyan-400 hover:underline"
                            >
                              Retry
                            </button>
                          )}
                          <span
                            className={`text-[11px] font-mono px-2 py-0.5 rounded ${
                              task.status === 'completed'
                                ? 'bg-emerald-950 border border-emerald-600/40 text-emerald-300'
                                : task.status === 'error'
                                ? 'bg-red-950 border border-red-600/40 text-red-300'
                                : task.stage === 'checking_mail' || task.stage === 'triggering_email' || task.stage === 'polling_gas'
                                ? 'bg-amber-950/80 border border-amber-600/50 text-amber-300'
                                : task.stage === 'packaging_info'
                                ? 'bg-indigo-950/80 border border-indigo-600/50 text-indigo-300'
                                : task.status === 'queued'
                                ? 'bg-slate-900 border border-slate-700 text-slate-400'
                                : 'bg-cyan-950 border border-cyan-600/40 text-cyan-300'
                            }`}
                          >
                            {task.stageName || task.status}
                            {task.status !== 'queued' && task.status !== 'completed' ? ` (${task.progress}%)` : ''}
                          </span>
                        </div>
                      </div>

                      {/* Stage Progress Bar */}
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            task.status === 'completed'
                              ? 'bg-emerald-400'
                              : task.status === 'error'
                              ? 'bg-red-400'
                              : task.stage === 'checking_mail' || task.stage === 'triggering_email' || task.stage === 'polling_gas'
                              ? 'bg-amber-400'
                              : task.stage === 'packaging_info'
                              ? 'bg-indigo-400'
                              : 'bg-cyan-400'
                          }`}
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>

                      {/* Pipeline Step Indicators & Detailed Live Status */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-[10px]">
                        <div className="flex items-center gap-1 font-mono">
                          {steps.map((stepLabel, idx) => {
                            const stepNum = idx + 1;
                            const isDone = task.status === 'completed' || currentStepIdx > stepNum;
                            const isCurrent = task.status !== 'completed' && currentStepIdx === stepNum;
                            const isFailedStep = task.status === 'error' && stepNum === 5;
                            return (
                              <span
                                key={stepLabel}
                                className={`px-1.5 py-0.5 rounded border ${
                                  isFailedStep
                                    ? 'bg-red-950/60 border-red-700/60 text-red-300'
                                    : isDone
                                    ? 'bg-emerald-950/50 border-emerald-700/40 text-emerald-400'
                                    : isCurrent
                                    ? 'bg-cyan-950/70 border-cyan-500/60 text-cyan-300 font-semibold'
                                    : 'bg-slate-900/60 border-slate-800 text-slate-600'
                                }`}
                              >
                                {stepLabel}
                              </span>
                            );
                          })}
                        </div>
                        {task.statusText && task.statusText !== task.stageName && (
                          <span className="text-slate-400 truncate max-w-full sm:max-w-[55%]" title={task.statusText}>
                            {task.statusText}
                          </span>
                        )}
                      </div>

                      {task.error && (
                        <div className="text-[11px] text-red-400 bg-red-950/30 p-2 rounded border border-red-900/40">
                          {task.error}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Export Links Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#111827] border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-base">Export Download Links</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Direct links to selected releases formatted for wget/cURL or external downloaders.
                </p>
              </div>
              <button
                onClick={() => setShowExportModal(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 font-mono text-xs text-slate-300 bg-[#0b0f17] select-all whitespace-pre leading-relaxed border-b border-slate-800">
              {generateExportText()}
            </div>

            <div className="p-4 flex items-center justify-between bg-[#111827]">
              <span className="text-xs text-slate-400">
                {selectedCount} releases · format: {selectedFormat.toUpperCase()}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadExportTxt}
                  className="px-4 py-2 bg-cyan-400 hover:bg-cyan-300 text-slate-950 rounded-lg text-xs font-bold transition"
                >
                  Download .txt File
                </button>
                <button
                  onClick={() => setShowExportModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
