import React, { useRef, useState } from 'react';
import { Download, Upload, FileJson, Check, AlertCircle } from 'lucide-react';
import type { TravelLedger } from '../types';
import { parseLedgerBackupText } from '../utils/ledgerBackup';

interface LedgerBackupPanelProps {
  currentLedger: TravelLedger;
  tripCount: number;
  onExportLedger: (scope: 'single' | 'all') => Promise<string>;
  onImportLedgers: (
    ledgers: TravelLedger[],
    mode: 'overwrite' | 'create_new'
  ) => Promise<{
    importedCount: number;
    importedExpenseCount: number;
    activeTripName: string;
  }>;
  compact?: boolean;
}

export const LedgerBackupPanel: React.FC<LedgerBackupPanelProps> = ({
  currentLedger,
  tripCount,
  onExportLedger,
  onImportLedgers,
  compact = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importMode, setImportMode] = useState<'overwrite' | 'create_new'>('overwrite');
  const [exportingScope, setExportingScope] = useState<'single' | 'all' | null>(null);
  const [importing, setImporting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const showSuccess = (msg: string) => {
    setErrorMsg('');
    setSuccessMsg(msg);
  };

  const handleExport = async (scope: 'single' | 'all') => {
    setErrorMsg('');
    setSuccessMsg('');
    setExportingScope(scope);
    try {
      const filename = await onExportLedger(scope);
      showSuccess(`已匯出檔案：${filename}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '匯出帳本檔案失敗');
    } finally {
      setExportingScope(null);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setErrorMsg('');
    setSuccessMsg('');
    setImporting(true);
    try {
      const text = await file.text();
      const parsedLedgers = parseLedgerBackupText(text);
      const result = await onImportLedgers(parsedLedgers, importMode);
      showSuccess(
        `已成功匯入 ${result.importedCount} 本帳本（共 ${result.importedExpenseCount} 筆消費紀錄），目前開啟「${result.activeTripName}」`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '匯入檔案失敗，請確認檔案內容');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className={compact ? 'space-y-3' : 'space-y-5'}>
      {/* Current Backup Status (Yellow Read-Only) */}
      <div className="display-yellow rounded-xl px-4 py-3 space-y-1">
        <div className="text-xs font-semibold opacity-80 flex items-center gap-1.5">
          <FileJson className="w-4 h-4 shrink-0" />
          <span>帳本備份與跨裝置移轉格式（.json 完整紀錄檔）</span>
        </div>
        <div className="text-xs sm:text-sm font-bold">
          目前帳本：{currentLedger.settings.tripName}（{currentLedger.expenses.length} 筆消費 · 共{' '}
          {tripCount} 本已儲存帳本）
        </div>
        <p className="text-[11px] opacity-80 leading-relaxed">
          匯出檔案會完整保存行程設定、貨幣匯率、預算分類與所有消費明細，可於手機與電腦間隨時還原匯入。
        </p>
      </div>

      {/* Export Controls */}
      <div className="space-y-2">
        <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
          匯出所記錄的內容檔案
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => handleExport('single')}
            disabled={exportingScope !== null || importing}
            className="control-green-active h-11 px-4 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-50"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>
              {exportingScope === 'single' ? '匯出中...' : '匯出目前帳本 (.json)'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleExport('all')}
            disabled={exportingScope !== null || importing}
            className="control-green h-11 px-4 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-50"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>
              {exportingScope === 'all'
                ? '匯出中...'
                : `匯出全部帳本（${tripCount} 本）`}
            </span>
          </button>
        </div>
      </div>

      {/* Import Controls */}
      <div className="space-y-2.5 pt-1 border-t border-slate-100 dark:border-slate-800">
        <div className="text-xs font-bold text-slate-800 dark:text-slate-200 pt-2">
          匯入備份檔案還原記錄
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setImportMode('overwrite')}
            className={`h-10 px-3 rounded-lg text-xs font-semibold whitespace-nowrap ${
              importMode === 'overwrite' ? 'control-green-active' : 'control-green'
            }`}
          >
            覆蓋同代碼帳本
          </button>
          <button
            type="button"
            onClick={() => setImportMode('create_new')}
            className={`h-10 px-3 rounded-lg text-xs font-semibold whitespace-nowrap ${
              importMode === 'create_new' ? 'control-green-active' : 'control-green'
            }`}
          >
            另存為新旅行帳本
          </button>
        </div>

        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {importMode === 'overwrite'
            ? '若檔案內有相同代碼的帳本將直接更新覆蓋，不存在的帳本則自動新增。'
            : '保留現有帳本不變，將檔案內所有帳本建立為全新獨立副本。'}
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleFileChange}
          className="hidden"
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing || exportingScope !== null}
          className="control-green-active w-full sm:w-auto h-11 px-5 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-50"
        >
          <Upload className="w-4 h-4 shrink-0" />
          <span>{importing ? '正在匯入資料...' : '選擇 .json 檔案並匯入'}</span>
        </button>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3.5 py-2.5 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="rounded-xl border border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-2.5 text-xs text-emerald-900 dark:text-emerald-200 flex items-start gap-2 font-semibold">
          <Check className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}
    </div>
  );
};
