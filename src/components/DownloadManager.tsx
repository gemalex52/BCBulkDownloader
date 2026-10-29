import React, { useState } from 'react';
import { AUDIO_FORMATS, DeliveryMode, DownloadTask, ScannedRelease, formatFilenameBySchema } from '../types/bandcamp';
import {
  Download,
  FolderArchive,
  Layers,
  FileCode,
  CheckCircle2,
  X,
  RotateCw,
  FileText
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
  isDownloading: boolean;
  downloadTasks: DownloadTask[];
  onCancelDownload: () => void;
  onRetryTask: (taskId: string) => void;
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
  isDownloading,
  downloadTasks,
  onCancelDownload,
  onRetryTask,
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

  const completedCount = downloadTasks.filter((t) => t.status === 'completed').length;
  const totalTaskCount = downloadTasks.length;
  const overallProgress =
    totalTaskCount > 0
      ? Math.round(
          downloadTasks.reduce((acc, t) => acc + t.progress, 0) / totalTaskCount
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
                <span>Mode: {deliveryMode === 'zip' ? 'ZIP Bundle (with cover & info.txt)' : 'Individual Files'}</span>
                {requiresEmailCount > 0 && (
                  <>
                    <span className="text-slate-600">·</span>
                    <span className="text-amber-400">{requiresEmailCount} require email auto-fill</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Controls: Format Selector & Delivery Mode */}
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

            {/* Delivery Mode Toggle */}
            <div className="flex items-center bg-[#111827] border border-slate-700 rounded-lg p-1 text-xs">
              <button
                onClick={() => onDeliveryModeChange('zip')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition font-medium ${
                  deliveryMode === 'zip'
                    ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Download all albums in unified ZIP bundles with artwork and info.txt"
              >
                <FolderArchive className="w-3.5 h-3.5" />
                <span>ZIP Bundle</span>
              </button>
              <button
                onClick={() => onDeliveryModeChange('individual')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition font-medium ${
                  deliveryMode === 'individual'
                    ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Download each album as separate browser downloads"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Individual</span>
              </button>
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
                    placeholder="%artist% - %date% - %album%/[%track_num%. ]%title%.%format%"
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
                        },
                        { allowSubfolders: deliveryMode === 'zip' }
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

            {/* Primary Action Button */}
            {isDownloading ? (
              <button
                onClick={() => setShowQueueModal(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-bold rounded-lg transition shadow-md"
              >
                <RotateCw className="w-3.5 h-3.5 animate-spin" />
                <span>
                  Downloading ({completedCount}/{totalTaskCount} · {overallProgress}%)
                </span>
              </button>
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
                <span>Start Bulk Download ({selectedCount})</span>
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
                  Format: {currentFormatObj.name} · Mode: {deliveryMode === 'zip' ? 'ZIP Archive' : 'Direct Downloads'}
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
                  ({completedCount}/{totalTaskCount} completed)
                </span>
              </div>
              {isDownloading && (
                <button
                  onClick={onCancelDownload}
                  className="text-rose-400 hover:text-rose-300 font-sans text-xs underline"
                >
                  Cancel Remaining
                </button>
              )}
            </div>

            {/* Task Item List */}
            <div className="p-5 overflow-y-auto space-y-3 flex-1">
              {downloadTasks.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-xs">
                  No active tasks in queue.
                </div>
              ) : (
                downloadTasks.map((task) => (
                  <div
                    key={task.id}
                    className="p-3 bg-[#0b0f17] border border-slate-800/80 rounded-xl flex items-center gap-3.5"
                  >
                    <div className="w-10 h-10 rounded bg-slate-900 overflow-hidden shrink-0">
                      {task.artUrl ? (
                        <img
                          src={task.artUrl}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : null}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-white truncate max-w-xs">
                          {task.releaseTitle}
                        </span>
                        <span className="font-mono text-[11px] text-slate-400 capitalize">
                          {task.status === 'downloading'
                            ? `${task.progress}%`
                            : task.status}
                        </span>
                      </div>

                      {/* Progress Bar */}
                      <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            task.status === 'completed'
                              ? 'bg-emerald-400'
                              : task.status === 'error'
                              ? 'bg-rose-500'
                              : 'bg-cyan-400'
                          }`}
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>

                      {task.error && (
                        <p className="text-[11px] text-rose-400 mt-1">{task.error}</p>
                      )}
                    </div>

                    {task.status === 'completed' && (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    )}
                    {task.status === 'error' && (
                      <button
                        onClick={() => onRetryTask(task.id)}
                        className="p-1.5 text-amber-400 hover:text-amber-300 shrink-0"
                        title="Retry download"
                      >
                        <RotateCw className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-800 bg-[#0d131f] flex justify-between items-center text-xs">
              <span className="text-slate-400">
                {isDownloading
                  ? 'Downloading sequentially to avoid rate-limiting...'
                  : completedCount === totalTaskCount && totalTaskCount > 0
                  ? 'All downloads completed successfully!'
                  : 'Ready.'}
              </span>
              <button
                onClick={() => setShowQueueModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium transition"
              >
                Close Queue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Links Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#111827] border border-slate-800 rounded-2xl w-full max-w-xl max-h-[80vh] flex flex-col shadow-2xl">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-white text-base">Export Download Links</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Export download URLs for command-line tools like curl, wget, or aria2c.
                </p>
              </div>
              <button
                onClick={() => setShowExportModal(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 flex-1 overflow-y-auto">
              <pre className="p-3 bg-[#0b0f17] border border-slate-800 rounded-lg text-xs font-mono text-cyan-300 overflow-x-auto whitespace-pre">
                {generateExportText()}
              </pre>
            </div>

            <div className="p-4 border-t border-slate-800 bg-[#0d131f] flex justify-end gap-3">
              <button
                onClick={() => setShowExportModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleDownloadExportTxt}
                className="flex items-center gap-1.5 px-4 py-2 bg-cyan-400 hover:bg-cyan-300 text-slate-950 rounded-lg text-xs font-semibold"
              >
                <FileText className="w-4 h-4" />
                <span>Save as .txt File</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
