export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000"

export const apiUrl = (path: string) => `${API_BASE_URL}${path}`

export const realtimeCallUrl = apiUrl("/api/realtime/call")
