import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'Error inesperado de renderizado en la interfaz.',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary capturó un error inesperado:', error, errorInfo);
  }

  private handleReload = (): void => {
    this.setState({ hasError: false, errorMessage: '' });
    window.location.reload();
  };

  public render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen w-screen items-center justify-center bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-lg dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Algo no salió como esperábamos
              </h1>
              <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                La interfaz encontró un problema inesperado. Tus archivos, configuración y
                transferencias no se vieron afectados.
              </p>
            </div>
          </div>

          {this.state.errorMessage && (
            <details className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-400">
              <summary className="cursor-pointer font-medium text-slate-700 select-none dark:text-slate-300">
                Ver detalle técnico
              </summary>
              <p className="mt-2 break-words font-mono text-[11px]">{this.state.errorMessage}</p>
            </details>
          )}

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              <RotateCw className="h-4 w-4" />
              Recargar interfaz
            </button>
          </div>
        </div>
      </div>
    );
  }
}
