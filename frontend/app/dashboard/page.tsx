"use client"

import { useCallback, useEffect, useState } from "react"
import OrderCard from "@/components/OrderCard"
import { RefreshCw, Loader2 } from "lucide-react"
import { apiUrl } from "@/lib/api"

interface Order {
  id: string
  customer_name: string
  contact_number: string
  guest_count: number
  date: string
  time: string
  special_requests?: string | null
  food_order?: Array<{ item: string; quantity: number; price: number }> | null
  payment_method: string
  status: string
  total_amount: number
  created_at: string
}

export default function DashboardPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiUrl("/api/bookings"))
      const data = await res.json()
      setOrders(data)
    } catch (e) {
      console.error("Failed to fetch orders:", e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const loadInitialOrders = async () => {
      try {
        const res = await fetch(apiUrl("/api/bookings"))
        const data = await res.json()
        setOrders(data)
      } catch (e) {
        console.error("Failed to fetch orders:", e)
      } finally {
        setLoading(false)
      }
    }

    loadInitialOrders()

    const eventSource = new EventSource(apiUrl("/api/bookings/sse"))

    eventSource.onopen = () => setConnected(true)
    eventSource.onerror = () => setConnected(false)

    eventSource.onmessage = (event) => {
      try {
        const newBooking = JSON.parse(event.data)
        setOrders((prev) => [newBooking, ...prev])
      } catch {}
    }

    return () => {
      eventSource.close()
    }
  }, [])

  return (
    <div className="min-h-[calc(100vh-73px)] p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Restaurant Dashboard</h1>
            <p className="text-gray-400 text-sm mt-1">
              Orders & bookings - {connected ? "Live updates active" : "Reconnecting..."}
            </p>
          </div>
          <button
            onClick={fetchOrders}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm transition-colors border border-gray-700"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        {loading && orders.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-green-400 animate-spin" />
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p className="text-lg">No bookings yet</p>
            <p className="text-sm mt-2">
              Bookings and orders will appear here in real-time as they come in.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {orders.map((order) => (
              <OrderCard key={order.id} {...order} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
