import React from 'react';
import type { Metadata, Viewport } from 'next';
import '../styles/tailwind.css';
import { Toaster } from 'sonner';
import ClientErrorBoundary from './components/ClientErrorBoundary';
import GlobalGenerationOverlay from './components/GlobalGenerationOverlay';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'TimeToDeny — Local Model Interface',
  description: 'TTD is a terminal-style local AI model interface with real-time streaming, file generation, and system monitoring.',
  icons: {
    icon: [{ url: '/favicon.ico', type: 'image/x-icon' }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-ttd-bg text-ttd-text scanline-overlay min-h-screen">
        <ClientErrorBoundary>
          {children}
          <GlobalGenerationOverlay />
        </ClientErrorBoundary>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#141414',
              border: '1px solid #2a2a2a',
              color: '#e8e8e8',
              fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
              fontSize: '12px',
              borderRadius: '3px',
            },
          }}
        />

      </body>
    </html>
  );
}
