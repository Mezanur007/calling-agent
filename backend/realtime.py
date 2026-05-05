import json
import os

import httpx
from fastapi import HTTPException, Request, Response
from dotenv import load_dotenv

from config_loader import get_config

load_dotenv()


def _session_instructions() -> str:
    config = get_config()
    restaurant = config["restaurant"]
    menu = "\n".join(
        f"- {item['name']} (${item['price']:.2f}): {item['description']}"
        for item in restaurant["menu"]
    )
    hours = "\n".join(
        f"- {day.capitalize()}: {value}"
        for day, value in restaurant["hours"].items()
    )

    return f"""You are a natural, warm female restaurant phone receptionist for {restaurant['name']}.
Cuisine: {restaurant['cuisine']}
Address: {restaurant['address']}
Phone: {restaurant['phone']}

Hours:
{hours}

Menu:
{menu}

Call behavior:
- Sound relaxed, friendly, and conversational, like a skilled human host.
- Use small natural acknowledgements when helpful, such as "Sure", "Of course", or "Absolutely".
- Vary your phrasing. Do not repeat the same template.
- Keep turns short, usually one sentence, and avoid sounding scripted.
- Let the customer interrupt you. If they speak, stop and listen.
- Ask one question at a time.
- Help with either table bookings or takeaway orders.
- For bookings collect name, phone number, number of guests, date, and time.
- Maximum table size is {restaurant['booking']['max_guests_per_table']} guests.
- Table slots are {restaurant['booking']['slot_duration_minutes']} minutes.
- Confirm the final details before saying the booking is confirmed.
- If you do not hear the customer, ask once briefly, then wait.
"""


async def create_realtime_call(request: Request) -> Response:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not set")

    sdp = await request.body()
    if not sdp:
        raise HTTPException(status_code=400, detail="Missing SDP offer")

    session_config = {
        "type": "realtime",
        "model": os.getenv("OPENAI_REALTIME_MODEL", "gpt-realtime"),
        "instructions": _session_instructions(),
        "audio": {
            "input": {
                "transcription": {"model": "gpt-4o-mini-transcribe"},
                "turn_detection": {
                    "type": "semantic_vad",
                    "eagerness": "medium",
                    "create_response": True,
                    "interrupt_response": True,
                },
            },
            "output": {
                "voice": os.getenv("OPENAI_REALTIME_VOICE", "shimmer"),
                "speed": 0.96,
            },
        },
    }

    files = {
        "sdp": (None, sdp, "application/sdp"),
        "session": (None, json.dumps(session_config), "application/json"),
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            "https://api.openai.com/v1/realtime/calls",
            headers={"Authorization": f"Bearer {api_key}"},
            files=files,
        )

    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text)

    return Response(content=response.text, media_type="application/sdp")
