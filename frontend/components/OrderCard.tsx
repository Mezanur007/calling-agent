import { cn } from "@/lib/utils"

interface OrderItem {
  item: string
  quantity: number
  price: number
}

interface OrderCardProps {
  id: string
  customer_name: string
  contact_number: string
  guest_count: number
  date: string
  time: string
  special_requests?: string | null
  food_order?: OrderItem[] | null
  payment_method: string
  status: string
  total_amount: number
  created_at: string
}

export default function OrderCard(order: OrderCardProps) {
  const statusColors: Record<string, string> = {
    confirmed: "bg-green-600/20 text-green-400 border-green-600",
    cancelled: "bg-red-600/20 text-red-400 border-red-600",
    completed: "bg-blue-600/20 text-blue-400 border-blue-600",
  }

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-4 hover:border-gray-600 transition-colors">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-lg font-semibold text-white">
            {order.customer_name}
          </h3>
          <p className="text-sm text-gray-400">{order.contact_number}</p>
        </div>
        <span
          className={cn(
            "px-3 py-1 rounded-full text-xs font-medium border",
            statusColors[order.status] || statusColors.confirmed
          )}
        >
          {order.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-gray-500">Guests</span>
          <p className="text-white font-medium">{order.guest_count}</p>
        </div>
        <div>
          <span className="text-gray-500">Date & Time</span>
          <p className="text-white font-medium">
            {order.date} at {order.time}
          </p>
        </div>
        <div>
          <span className="text-gray-500">Payment</span>
          <p className="text-white font-medium capitalize">
            {order.payment_method.replace(/_/g, " ")}
          </p>
        </div>
        <div>
          <span className="text-gray-500">Total</span>
          <p className="text-white font-medium">
            ${order.total_amount.toFixed(2)}
          </p>
        </div>
      </div>

      {order.food_order && order.food_order.length > 0 && (
        <div>
          <span className="text-gray-500 text-sm">Food Order</span>
          <ul className="mt-1 space-y-1">
            {order.food_order.map((item, i) => (
              <li key={i} className="text-white text-sm flex justify-between">
                <span>
                  {item.quantity}x {item.item}
                </span>
                <span className="text-gray-400">
                  ${(item.price * item.quantity).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {order.special_requests && (
        <div>
          <span className="text-gray-500 text-sm">Special Requests</span>
          <p className="text-white text-sm mt-1 bg-gray-900 rounded-lg p-2">
            {order.special_requests}
          </p>
        </div>
      )}

      <p className="text-xs text-gray-600">
        {new Date(order.created_at).toLocaleString()}
      </p>
    </div>
  )
}
