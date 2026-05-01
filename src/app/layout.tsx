import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Cream — Company Intelligence',
  description: 'The partner founders rely on when each hire changes the trajectory of the business.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garant:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Instrument+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  )
}
