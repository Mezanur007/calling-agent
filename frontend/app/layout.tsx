import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import Link from "next/link"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Calling Agent - Restaurant Booking",
  description: "AI-powered restaurant booking agent",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} min-h-screen`}>
        <nav className="border-b border-gray-800 px-6 py-4 flex items-center gap-6">
          <Link href="/" className="text-lg font-bold text-white hover:text-green-400 transition-colors">
            La Dolce Vita
          </Link>
          <div className="flex gap-4 ml-auto">
            <Link
              href="/call"
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Call
            </Link>
            <Link
              href="/dashboard"
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Dashboard
            </Link>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  )
}
