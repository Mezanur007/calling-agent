"use client"

import { cn } from "@/lib/utils"

interface Props {
  status: "idle" | "connecting" | "connected" | "ended"
}

export default function AudioVisualizer({ status }: Props) {
  const isActive = status === "connected"
  const bars = [
    { height: 35, duration: 0.9 },
    { height: 58, duration: 1.2 },
    { height: 42, duration: 0.85 },
    { height: 76, duration: 1.35 },
    { height: 54, duration: 1.05 },
    { height: 88, duration: 1.45 },
    { height: 62, duration: 1.1 },
    { height: 80, duration: 1.3 },
    { height: 48, duration: 0.95 },
    { height: 70, duration: 1.25 },
    { height: 40, duration: 0.8 },
    { height: 56, duration: 1.15 },
  ]

  return (
    <div className="flex items-end justify-center gap-1 h-16">
      {bars.map((bar, i) => {
        const delay = i * 0.15
        return (
          <div
            key={i}
            className={cn(
              "w-2 rounded-full transition-all",
              isActive
                ? "bg-green-400 animate-pulse"
                : "bg-gray-600"
            )}
            style={
              isActive
                ? {
                    height: `${bar.height}%`,
                    animationDelay: `${delay}s`,
                    animationDuration: `${bar.duration}s`,
                  }
                : { height: "30%" }
            }
          />
        )
      })}
    </div>
  )
}
