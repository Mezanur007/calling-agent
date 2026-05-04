"use client"

import { cn } from "@/lib/utils"

interface Props {
  status: "idle" | "connecting" | "connected" | "ended"
}

export default function AudioVisualizer({ status }: Props) {
  const bars = 12
  const isActive = status === "connected"

  return (
    <div className="flex items-end justify-center gap-1 h-16">
      {Array.from({ length: bars }).map((_, i) => {
        const delay = i * 0.15
        const duration = 0.8 + Math.random() * 1.2
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
                    height: `${20 + Math.random() * 80}%`,
                    animationDelay: `${delay}s`,
                    animationDuration: `${duration}s`,
                  }
                : { height: "30%" }
            }
          />
        )
      })}
    </div>
  )
}
