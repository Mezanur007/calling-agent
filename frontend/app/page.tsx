import Link from "next/link"
import { Phone, BarChart3 } from "lucide-react"

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-73px)] p-6">
      <div className="max-w-lg w-full text-center space-y-8">
        <div className="space-y-4">
          <h1 className="text-4xl font-bold text-white">La Dolce Vita</h1>
          <p className="text-gray-400 text-lg">
            AI-Powered Restaurant Calling Agent
          </p>
        </div>

        <div className="grid gap-4">
          <Link
            href="/call"
            className="flex items-center gap-4 p-6 bg-gray-800 rounded-xl border border-gray-700 hover:border-green-600 transition-colors group"
          >
            <div className="w-12 h-12 bg-green-600/20 rounded-lg flex items-center justify-center group-hover:bg-green-600/30 transition-colors">
              <Phone className="w-6 h-6 text-green-400" />
            </div>
            <div className="text-left">
              <h2 className="text-lg font-semibold text-white">Make a Call</h2>
              <p className="text-sm text-gray-400">
                Speak with our AI agent to book a table or order food
              </p>
            </div>
          </Link>

          <Link
            href="/dashboard"
            className="flex items-center gap-4 p-6 bg-gray-800 rounded-xl border border-gray-700 hover:border-green-600 transition-colors group"
          >
            <div className="w-12 h-12 bg-green-600/20 rounded-lg flex items-center justify-center group-hover:bg-green-600/30 transition-colors">
              <BarChart3 className="w-6 h-6 text-green-400" />
            </div>
            <div className="text-left">
              <h2 className="text-lg font-semibold text-white">Dashboard</h2>
              <p className="text-sm text-gray-400">
                View bookings and orders in real-time
              </p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
