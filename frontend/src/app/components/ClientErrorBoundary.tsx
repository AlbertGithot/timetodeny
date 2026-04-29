'use client';

import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export default class ClientErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('TTD client error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen bg-ttd-bg text-ttd-text flex items-center justify-center px-4">
        <div className="max-w-2xl w-full border border-ttd-red/35 bg-ttd-red/5 rounded-sm p-5">
          <div className="text-ttd-red text-sm font-bold tracking-wider mb-2">CLIENT RENDER ERROR</div>
          <div className="text-sm text-ttd-muted mb-4">
            Фронт поймал ошибку вместо чёрного экрана. Уже лучше, чем Next-надгробие.
          </div>
          <pre className="text-xs text-ttd-red/85 whitespace-pre-wrap max-h-56 overflow-auto">
            {this.state.error.message}
            {this.state.error.stack ? `\n\n${this.state.error.stack}` : ''}
          </pre>
          <button
            type="button"
            className="ttd-btn ttd-btn-red mt-4 text-xs"
            onClick={() => window.location.reload()}
          >
            RELOAD
          </button>
        </div>
      </div>
    );
  }
}
