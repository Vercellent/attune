import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import localFont from 'next/font/local'
import './globals.css'

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })
const editorial = localFont({
  variable: '--font-editorial',
  display: 'swap',
  src: [
    { path: '../public/fonts/PPEditorialNew-Ultralight.otf', weight: '200', style: 'normal' },
    { path: '../public/fonts/PPEditorialNew-UltralightItalic.otf', weight: '200', style: 'italic' },
    { path: '../public/fonts/PPEditorialNew-Regular.otf', weight: '400', style: 'normal' },
    { path: '../public/fonts/PPEditorialNew-Italic.otf', weight: '400', style: 'italic' },
  ],
})

export const metadata: Metadata = {
  title: 'Attune',
  description:
    'A self-improving experimentation harness: hypothesize, generate variants, test with real people, interview, learn, and rewrite the harness.',
  generator: 'v0.app',
  icons: {
    icon: [
      { url: '/icon-light-32x32.png', media: '(prefers-color-scheme: light)' },
      { url: '/icon-dark-32x32.png', media: '(prefers-color-scheme: dark)' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#fafaf7',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${editorial.variable} bg-background`}>
      <body className="font-sans antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
