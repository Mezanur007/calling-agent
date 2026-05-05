"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Phone, PhoneOff, Loader2, Send } from "lucide-react"
import { realtimeCallUrl } from "@/lib/api"

interface Message {
  speaker: "Agent" | "Customer"
  text: string
}

type CallStatus = "idle" | "connecting" | "connected" | "ended"

type RealtimeEvent = {
  type?: string
  delta?: string
  transcript?: string
  item_id?: string
  item?: {
    id?: string
    role?: string
    content?: Array<{ text?: string; transcript?: string }>
  }
  error?: {
    message?: string
  }
}

export default function CallButton({
  onTranscript,
  onStatusChange,
}: {
  onTranscript: (msgs: Message[]) => void
  onStatusChange: (s: CallStatus) => void
}) {
  const [status, setStatus] = useState<CallStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [micLevel, setMicLevel] = useState(0)
  const [textInput, setTextInput] = useState("")

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)
  const analyserCtxRef = useRef<AudioContext | null>(null)
  const analyserFrameRef = useRef<number | null>(null)
  const msgsRef = useRef<Message[]>([])
  const customerDraftsRef = useRef<Map<string, string>>(new Map())
  const agentDraftsRef = useRef<Map<string, string>>(new Map())
  const draftIndexesRef = useRef<Map<string, number>>(new Map())
  const finalizedItemsRef = useRef<Set<string>>(new Set())
  const cbRef = useRef({ onTranscript, onStatusChange })

  useEffect(() => {
    cbRef.current = { onTranscript, onStatusChange }
  }, [onTranscript, onStatusChange])

  const setCallStatus = useCallback((nextStatus: CallStatus) => {
    setStatus(nextStatus)
    cbRef.current.onStatusChange(nextStatus)
  }, [])

  const publishMessages = useCallback(() => {
    cbRef.current.onTranscript([...msgsRef.current])
  }, [])

  const appendMessage = useCallback((speaker: Message["speaker"], text: string, itemId?: string) => {
    const clean = text.trim()
    if (!clean) return

    if (itemId) {
      if (finalizedItemsRef.current.has(itemId)) return
      finalizedItemsRef.current.add(itemId)

      const draftIndex = draftIndexesRef.current.get(itemId)
      if (draftIndex !== undefined) {
        msgsRef.current = msgsRef.current.map((message, index) => (
          index === draftIndex ? { speaker, text: clean } : message
        ))
        draftIndexesRef.current.delete(itemId)
        publishMessages()
        return
      }
    }

    msgsRef.current = [...msgsRef.current, { speaker, text: clean }]
    publishMessages()
  }, [publishMessages])

  const updateDraft = useCallback((itemId: string, speaker: Message["speaker"], text: string) => {
    const clean = text.trim()
    if (!clean || finalizedItemsRef.current.has(itemId)) return

    const draftText = `${clean}...`
    const draftIndex = draftIndexesRef.current.get(itemId)

    if (draftIndex !== undefined) {
      msgsRef.current = msgsRef.current.map((message, index) => (
        index === draftIndex ? { speaker, text: draftText } : message
      ))
    } else {
      draftIndexesRef.current.set(itemId, msgsRef.current.length)
      msgsRef.current = [...msgsRef.current, { speaker, text: draftText }]
    }

    publishMessages()
  }, [publishMessages])

  const stopMicMeter = useCallback(() => {
    if (analyserFrameRef.current !== null) {
      cancelAnimationFrame(analyserFrameRef.current)
      analyserFrameRef.current = null
    }
    analyserCtxRef.current?.close().catch(() => {})
    analyserCtxRef.current = null
    setMicLevel(0)
  }, [])

  const stopAll = useCallback(() => {
    stopMicMeter()
    dcRef.current?.close()
    dcRef.current = null
    pcRef.current?.close()
    pcRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause()
      remoteAudioRef.current.srcObject = null
    }
  }, [stopMicMeter])

  const endCall = useCallback(() => {
    stopAll()
    setCallStatus("ended")
  }, [setCallStatus, stopAll])

  const startMicMeter = useCallback((stream: MediaStream) => {
    stopMicMeter()
    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    analyserCtxRef.current = ctx

    const data = new Uint8Array(analyser.fftSize)
    const tick = () => {
      analyser.getByteTimeDomainData(data)
      let peak = 0
      for (const value of data) {
        const centered = Math.abs(value - 128) / 128
        if (centered > peak) peak = centered
      }
      setMicLevel(Math.min(100, Math.round(peak * 250)))
      analyserFrameRef.current = requestAnimationFrame(tick)
    }
    tick()
  }, [stopMicMeter])

  const handleRealtimeEvent = useCallback((event: RealtimeEvent) => {
    if (event.type === "error") {
      setError(event.error?.message || "Realtime voice session error")
      return
    }

    if (event.type === "conversation.item.input_audio_transcription.delta") {
      const itemId = event.item_id || "current-user"
      const next = `${customerDraftsRef.current.get(itemId) || ""}${event.delta || ""}`
      customerDraftsRef.current.set(itemId, next)
      updateDraft(itemId, "Customer", next)
      return
    }

    if (event.type === "conversation.item.input_audio_transcription.completed") {
      const itemId = event.item_id || "current-user"
      customerDraftsRef.current.delete(itemId)
      appendMessage("Customer", event.transcript || "", itemId)
      return
    }

    if (event.type === "response.output_audio_transcript.delta") {
      const itemId = event.item_id || "current-agent"
      const next = `${agentDraftsRef.current.get(itemId) || ""}${event.delta || ""}`
      agentDraftsRef.current.set(itemId, next)
      updateDraft(itemId, "Agent", next)
      return
    }

    if (event.type === "response.output_audio_transcript.done") {
      const itemId = event.item_id || "current-agent"
      agentDraftsRef.current.delete(itemId)
      appendMessage("Agent", event.transcript || "", itemId)
      return
    }

    if (event.type === "conversation.item.done" && event.item?.role === "assistant") {
      const itemId = event.item.id || "current-agent"
      const content = event.item.content?.find((part) => part.transcript || part.text)
      appendMessage("Agent", content?.transcript || content?.text || "", itemId)
    }
  }, [appendMessage, updateDraft])

  const startCall = useCallback(async () => {
    setError(null)
    setCallStatus("connecting")
    msgsRef.current = []
    customerDraftsRef.current.clear()
    agentDraftsRef.current.clear()
    draftIndexesRef.current.clear()
    finalizedItemsRef.current.clear()
    publishMessages()

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream
      startMicMeter(stream)

      const pc = new RTCPeerConnection()
      pcRef.current = pc

      const audio = document.createElement("audio")
      audio.autoplay = true
      audio.setAttribute("playsinline", "true")
      remoteAudioRef.current = audio
      pc.ontrack = (event) => {
        audio.srcObject = event.streams[0]
        audio.play().catch(() => {})
      }

      stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream))

      const dc = pc.createDataChannel("oai-events")
      dcRef.current = dc

      dc.onmessage = (messageEvent) => {
        try {
          handleRealtimeEvent(JSON.parse(messageEvent.data))
        } catch {}
      }

      dc.onopen = () => {
        setCallStatus("connected")
        dc.send(JSON.stringify({
          type: "response.create",
          response: {
            instructions: "Greet the caller warmly and ask whether they want to book a table or place a takeaway order.",
          },
        }))
      }

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          setError("Realtime voice connection dropped.")
          endCall()
        }
      }

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      const response = await fetch(realtimeCallUrl, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp,
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      await pc.setRemoteDescription({
        type: "answer",
        sdp: await response.text(),
      })
    } catch (err) {
      console.error("[RealtimeCall] Error:", err)
      setError(err instanceof Error ? err.message : "Failed to start realtime voice")
      endCall()
    }
  }, [endCall, handleRealtimeEvent, publishMessages, setCallStatus, startMicMeter])

  const sendText = useCallback(() => {
    const text = textInput.trim()
    const dc = dcRef.current
    if (!text || !dc || dc.readyState !== "open") return

    dc.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    }))
    dc.send(JSON.stringify({ type: "response.create" }))

    appendMessage("Customer", text)
    setTextInput("")
  }, [appendMessage, textInput])

  useEffect(() => () => stopAll(), [stopAll])

  return (
    <div className="flex flex-col items-center gap-4">
      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 rounded-lg px-4 py-2 text-center max-w-md">{error}</div>
      )}

      {status === "idle" && (
        <button
          onClick={startCall}
          className="flex items-center gap-3 px-8 py-4 rounded-full text-lg font-semibold transition-all hover:scale-105 active:scale-95 shadow-lg bg-green-600 hover:bg-green-700 text-white shadow-green-600/25"
        >
          <Phone className="w-5 h-5" />
          Call Now
        </button>
      )}

      {status === "connecting" && (
        <div className="flex items-center gap-3 px-8 py-4 bg-yellow-600/80 text-white rounded-full text-lg font-semibold">
          <Loader2 className="w-5 h-5 animate-spin" /> Connecting...
        </div>
      )}

      {status === "connected" && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-400">Microphone level:</span>
            <div className="w-32 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-400 transition-all duration-100 rounded-full"
                style={{ width: `${micLevel}%` }}
              />
            </div>
          </div>
          <button
            onClick={endCall}
            className="flex items-center gap-3 px-8 py-4 rounded-full text-lg font-semibold transition-all hover:scale-105 active:scale-95 shadow-lg bg-red-600 hover:bg-red-700 text-white shadow-red-600/25"
          >
            <PhoneOff className="w-5 h-5" />
            End Call
          </button>
          <p className="text-green-400 text-sm flex items-center gap-2">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            Realtime call active — speak naturally
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              sendText()
            }}
            className="flex gap-2 w-full max-w-md"
          >
            <input
              value={textInput}
              onChange={(event) => setTextInput(event.target.value)}
              placeholder="Type your message..."
              className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-green-500"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </>
      )}

      {status === "ended" && (
        <button
          onClick={startCall}
          className="flex items-center gap-3 px-8 py-4 rounded-full text-lg font-semibold transition-all hover:scale-105 active:scale-95 shadow-lg bg-green-600 hover:bg-green-700 text-white shadow-green-600/25"
        >
          <Phone className="w-5 h-5" />
          Call Again
        </button>
      )}
    </div>
  )
}
