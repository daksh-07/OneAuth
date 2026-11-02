import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { ToastProvider } from '@/components/ui/toast';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'OneAuth — Your digital life. One identity.', template: '%s · OneAuth' },
  description:
    'Connect your devices with one passkey-protected identity. Approve new devices from your phone, give temporary access that expires, and revoke it any time.',
  applicationName: 'OneAuth',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#080d16' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get('oa_theme')?.value;
  const dataTheme = theme === 'light' || theme === 'dark' ? theme : undefined;
  return (
    <html lang="en-AU" data-theme={dataTheme} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only z-[70] rounded-control bg-surface px-4 py-2 text-sm font-medium shadow-mid focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
