import { useEffect, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  FolderOpen,
  ShieldAlert,
  ShieldOff,
  XCircle,
} from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useAppStore } from '../../store/useAppStore';
import { useNasStore } from '../../store/useNasStore';
import { invokeOpenInExplorer, isTauriRuntime } from '../../utils/tauri';

export function ThreatConsentModal() {
  const pendingThreatReport = useNasStore((s) => s.pendingThreatReport);
  const stopTransferDueToThreats = useNasStore((s) => s.stopTransferDueToThreats);
  const acceptThreatsAndContinue = useNasStore((s) => s.acceptThreatsAndContinue);
  const addToast = useAppStore((s) => s.addToast);

  const [acceptedLiability, setAcceptedLiability] = useState(false);

  const isOpen = pendingThreatReport !== null;

  useEffect(() => {
    setAcceptedLiability(false);
  }, [pendingThreatReport]);

  // Al presionar Escape, detiene el copiado de forma segura dejando el detalle en pantalla
  useEscapeKey(isOpen, () => {
    void stopTransferDueToThreats();
  });

  if (!pendingThreatReport) {
    return null;
  }

  const malwareCount = pendingThreatReport.findings.filter(
    (f) => f.severity === 'malware',
  ).length;
  const suspiciousCount = pendingThreatReport.findings.length - malwareCount;
  const hasMalware = malwareCount > 0;

  const handleOpenPath = async (filePath: string) => {
    if (!isTauriRuntime()) {
      return;
    }
    try {
      await invokeOpenInExplorer(filePath);
    } catch (err) {
      addToast({
        title: 'No se pudo abrir la ubicación',
        message: typeof err === 'string' ? err : 'No se pudo abrir el Explorador de Windows.',
        variant: 'error',
      });
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="threat-consent-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-red-300 bg-white shadow-2xl dark:border-red-800/80 dark:bg-slate-900">
        {/* Cabecera de alerta */}
        <div
          className={`flex items-start gap-3.5 border-b px-6 py-5 ${
            hasMalware
              ? 'border-red-200 bg-red-50/90 dark:border-red-900/70 dark:bg-red-950/50'
              : 'border-amber-200 bg-amber-50/90 dark:border-amber-900/70 dark:bg-amber-950/40'
          }`}
        >
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white ${
              hasMalware ? 'bg-red-600' : 'bg-amber-600'
            }`}
          >
            {hasMalware ? (
              <AlertOctagon className="h-6 w-6" />
            ) : (
              <ShieldAlert className="h-6 w-6" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3
              id="threat-consent-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              {hasMalware
                ? 'Alerta de seguridad: se detectó un posible virus o malware antes de copiar'
                : 'Advertencia de seguridad: se detectaron archivos sospechosos antes de copiar'}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
              El copiado hacia tu disco o NAS fue pausado automáticamente antes de transferir ningún
              archivo. Se analizaron{' '}
              <strong className="font-mono">{pendingThreatReport.filesScanned}</strong> archivo(s)
              {pendingThreatReport.defenderUsed
                ? ' con Windows Defender y análisis heurístico'
                : ' con análisis heurístico local'}
              :{' '}
              {malwareCount > 0 && (
                <strong className="text-red-700 dark:text-red-300">
                  {malwareCount} amenaza(s) grave(s)
                </strong>
              )}
              {malwareCount > 0 && suspiciousCount > 0 && ' y '}
              {suspiciousCount > 0 && (
                <strong className="text-amber-800 dark:text-amber-300">
                  {suspiciousCount} archivo(s) sospechoso(s)
                </strong>
              )}
              .
            </p>
          </div>
        </div>

        {/* Lista detallada de archivos detectados con su ruta completa */}
        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Detalle de lo encontrado y rutas exactas para verificación:
          </p>

          <ul className="space-y-2.5">
            {pendingThreatReport.findings.map((finding, idx) => {
              const isMalware = finding.severity === 'malware';
              return (
                <li
                  key={`${finding.filePath}-${idx}`}
                  className={`rounded-xl border p-3.5 text-xs ${
                    isMalware
                      ? 'border-red-200 bg-red-50/50 dark:border-red-900/60 dark:bg-red-950/30'
                      : 'border-amber-200 bg-amber-50/50 dark:border-amber-900/60 dark:bg-amber-950/25'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                          isMalware
                            ? 'bg-red-600 text-white'
                            : 'bg-amber-600 text-white'
                        }`}
                      >
                        {isMalware ? (
                          <AlertTriangle className="h-3 w-3" />
                        ) : (
                          <ShieldAlert className="h-3 w-3" />
                        )}
                        {isMalware ? 'Virus / Amenaza' : 'Archivo sospechoso'}
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {finding.threatName}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        · {finding.engine}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleOpenPath(finding.filePath)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <FolderOpen className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                      Abrir ubicación
                    </button>
                  </div>

                  <p className="mt-1.5 text-slate-700 dark:text-slate-300">{finding.reason}</p>

                  <div className="mt-2 rounded-lg bg-slate-900/5 px-2.5 py-1.5 font-mono text-[11px] break-all text-slate-800 dark:bg-slate-950/80 dark:text-slate-200">
                    {finding.filePath}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Casilla de responsabilidad explícita para omitir advertencia */}
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
            <input
              type="checkbox"
              checked={acceptedLiability}
              onChange={(e) => setAcceptedLiability(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-500"
            />
            <span className="leading-relaxed">
              <strong>Entiendo la advertencia y asumo las consecuencias:</strong> confirmo que deseo
              omitir esta alerta de seguridad bajo mi propia responsabilidad y continuar con el
              copiado hacia el disco o NAS.
            </span>
          </label>
        </div>

        {/* Botones de decisión */}
        <div className="flex flex-col-reverse gap-2.5 border-t border-slate-200 bg-slate-50/80 px-6 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-950/60">
          <button
            type="button"
            disabled={!acceptedLiability}
            onClick={() => void acceptThreatsAndContinue()}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-red-800 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/60"
          >
            <ShieldOff className="h-4 w-4" />
            <span>Omitir advertencia y continuar</span>
          </button>

          <button
            type="button"
            onClick={() => void stopTransferDueToThreats()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            <XCircle className="h-4 w-4" />
            <span>Detener copiado y revisar rutas (Recomendado)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
