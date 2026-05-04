import os
import asyncio
from deepgram import (
    DeepgramClient,
    LiveTranscriptionEvents,
    LiveOptions,
)
from dotenv import load_dotenv

load_dotenv()


class DeepgramSTT:
    def __init__(self):
        api_key = os.getenv("DEEPGRAM_API_KEY")
        if not api_key:
            raise ValueError("DEEPGRAM_API_KEY not set in environment")
        self.client = DeepgramClient(api_key)
        self.transcript_queue: asyncio.Queue = asyncio.Queue()
        self._connection = None
        self._keepalive_task = None
        self._running = False

    def _on_transcript(self, result, **kwargs):
        try:
            channel = result.channel
            if not channel or not channel.alternatives:
                return
            sentence = channel.alternatives[0].transcript
            if sentence:
                is_final = result.speech_final if hasattr(result, "speech_final") else True
                print(f"[Deepgram] Transcript{' (final)' if is_final else ''}: {sentence}")
                self.transcript_queue.put_nowait({"text": sentence.strip(), "is_final": is_final})
        except Exception as e:
            print(f"[Deepgram] Transcript parse error: {e}")

    def _on_error(self, error, **kwargs):
        print(f"[Deepgram] Error: {error}")

    def _on_close(self, *args, **kwargs):
        print("[Deepgram] Connection closed")
        self._running = False

    def _on_open(self, *args, **kwargs):
        print("[Deepgram] Connection opened")

    async def _keepalive(self):
        while self._running:
            try:
                if self._connection:
                    self._connection.keep_alive()
            except Exception as e:
                print(f"[Deepgram] Keepalive error: {e}")
            await asyncio.sleep(5)

    async def connect(self):
        self._running = True
        self._connection = self.client.listen.live.v("1")
        self._connection.on(LiveTranscriptionEvents.Open, self._on_open)
        self._connection.on(LiveTranscriptionEvents.Transcript, self._on_transcript)
        self._connection.on(LiveTranscriptionEvents.Error, self._on_error)
        self._connection.on(LiveTranscriptionEvents.Close, self._on_close)

        options = LiveOptions(
            model="nova-2",
            language="en-US",
            smart_format=True,
            interim_results=True,
            utterance_end_ms=1000,
            encoding="linear16",
            sample_rate=48000,
            channels=1,
            endpointing=300,
        )
        started = self._connection.start(options)
        print(f"[Deepgram] Start result: {started}")
        self._keepalive_task = asyncio.create_task(self._keepalive())
        return started

    async def send_audio(self, audio_bytes: bytes):
        if self._connection and self._running:
            try:
                self._connection.send(audio_bytes)
            except Exception as e:
                print(f"[Deepgram] Send error: {e}")

    async def receive_transcript(self):
        try:
            return await asyncio.wait_for(self.transcript_queue.get(), timeout=30.0)
        except asyncio.TimeoutError:
            return None

    async def close(self):
        self._running = False
        if self._keepalive_task:
            self._keepalive_task.cancel()
            try:
                await self._keepalive_task
            except asyncio.CancelledError:
                pass
        if self._connection:
            try:
                self._connection.finish()
            except Exception as e:
                print(f"[Deepgram] Close error: {e}")
