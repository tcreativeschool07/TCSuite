import { Schibsted_Grotesk, Newsreader } from 'next/font/google'
import { Toaster } from 'react-hot-toast'
import { ThemeProvider } from '@/src/contexts/ThemeContext'
import { AuthProvider } from '@/src/contexts/AuthContext'
import './globals.css'

const fontUi = Schibsted_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ui',
  display: 'swap',
})

const fontDisplay = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
})

export const metadata = {
  title: 'The Creative School',
  description: 'Student administration, fee collection, and reporting for The Creative School.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${fontUi.variable} ${fontDisplay.variable}`} suppressHydrationWarning>
      <head>
        {/* Dark-mode no-flash: same localStorage key ('theme') and class strategy as the old app. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
  (function(){try{var t=localStorage.getItem('theme');
  if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))
  document.documentElement.classList.add('dark');}catch(e){}})();
`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            {children}
            {/* Restyled — position, duration and events unchanged. */}
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 4000,
                style: {
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  border: '1px solid var(--edge)',
                  borderRadius: '10px',
                  boxShadow: 'var(--shadow-overlay)',
                  fontSize: '14px',
                },
                success: {
                  iconTheme: { primary: 'var(--accent)', secondary: 'var(--on-accent)' },
                  style: { borderLeft: '3px solid var(--accent)' },
                },
                error: {
                  iconTheme: { primary: 'var(--danger)', secondary: 'var(--surface)' },
                  style: { borderLeft: '3px solid var(--danger)' },
                },
                loading: {
                  iconTheme: { primary: 'var(--accent)', secondary: 'var(--accent-tint)' },
                },
              }}
            />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
