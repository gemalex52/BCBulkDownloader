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
  onStartBulkDownload: () => void;
  onResumeBulkDownload?: () => void;
  canResume?: boolean;
  pendingCount?: number;
  failedCount?: number;
  completedCount?: number;
  isDownloading: boolean;
  downloadTasks: DownloadTask[];
  onCancelDownload: () => void;
  onRetryTask: (taskId: string) => void;
  activePacingNotice?: string;
  createCompanionInfoZip?: boolean;
}

export const DownloadManager: React.FC<DownloadManagerProps> = ({
  selectedReleases,
  selectedFormat,
  onFormatChange,
  deliveryMode,
  onDeliveryModeChange,
  namingSchema,
  onNamingSchemaChange,
  onStartBulkDownload,
  onResumeBulkDownload,
  canResume = false,
  pendingCount = 0,
  failedCount = 0,
  completedCount = 0,
  isDownloading,
  downloadTasks,
  onCancelDownload,
  onRetryTask,
  activePacingNotice,
  createCompanionInfoZip = true,
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
  const overallProgress =
    totalTaskCount > 0
      ? Math.round(
          (completedCount / totalTaskCount) * 100
        )
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

          {/* Controls: Format Selector & Action Buttons */}
          <div className="flex flex-wrap items-center gap-3">
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

            {/* Primary Action Button (Dynamic Resume vs Start) */}
            {isDownloading ? (
              <button
                onClick={() => setShowQueueModal(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-bold rounded-lg transition shadow-md"
              >
                <RotateCw className="w-3.5 h-3.5 animate-spin" />
                <span>
                  Processing ({completedCount}/{totalTaskCount} · {overallProgress}%)
                </span>
              </button>
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
              </div>
            ) : (
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
            )}
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
            <div className="px-5 py-3 bg-[#0d131f] border-b border-slate-800 flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Total Progress:</span>
                <span className="text-cyan-400 font-semibold">{overallProgress}%</span>
                <span className="text-slate-500">
                  ({completedCount}/{totalTaskCount} completed
                  {failedCount > 0 ? `, ${failedCount} failed` : ''})
                </span>
              </div>
              {isDownloading && (
                <button
                  onClick={onCancelDownload}
                  className="text-red-400 hover:text-red-300 font-sans text-xs underline"
                >
                  Pause Queue
                </button>
              )}
            </div>

            {/* Task List */}
            <div className="p-5 overflow-y-auto flex-1 space-y-3">
              {downloadTasks.length === 0 ? (
                <div className="py-8 text-center text-slate-500 text-xs">
                  No downloads currently in queue.
                </div>
              ) : (
                downloadTasks.map((task) => (
                  <div
                    key={task.id}
                    className="p-3 bg-[#0d131f] border border-slate-800 rounded-xl space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        {task.status === 'completed' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : task.status === 'error' ? (
                          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                        ) : (
                          <RotateCw className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />
                        )}
                        <span className="font-semibold text-white truncate">{task.releaseTitle}</span>
                        <span className="text-slate-500 text-[11px] truncate">· {task.artist}</span>
                      </div>

                      <div className="flex items-center gap-2">
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
                              ? 'bg-emerald-950 text-emerald-300'
                              : task.status === 'error'
                              ? 'bg-red-950 text-red-300'
                              : 'bg-cyan-950 text-cyan-300'
                          }`}
                        >
                          {task.status}
                        </span>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          task.status === 'completed'
                            ? 'bg-emerald-400'
                            : task.status === 'error'
                            ? 'bg-red-400'
                            : 'bg-cyan-400'
                        }`}
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>

                    {task.error && (
                      <div className="text-[11px] text-red-400 bg-red-950/30 p-2 rounded border border-red-900/40">
                        {task.error}
                      </div>
                    )}
                  </div>
                ))
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
