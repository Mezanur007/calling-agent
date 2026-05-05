import os
from typing import AsyncGenerator
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))


async def text_to_speech(text: str) -> bytes:
    """Convert text to PCM 16-bit 24kHz mono audio bytes."""
    response = await client.audio.speech.create(
        model="tts-1",
        voice="alloy",
        input=text,
        response_format="pcm",
        speed=1.12,
    )
    return response.content


async def text_to_speech_stream(text: str) -> AsyncGenerator[bytes, None]:
    """Stream PCM 16-bit 24kHz mono audio bytes."""
    async with client.audio.speech.with_streaming_response.create(
        model="tts-1",
        voice="alloy",
        input=text,
        response_format="pcm",
        speed=1.12,
    ) as response:
        async for chunk in response.iter_bytes(chunk_size=8192):
            if chunk:
                yield chunk
