import os
import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import init_db, get_db
from models import Booking
from ws_handler import handle_call
from dotenv import load_dotenv

load_dotenv()

sse_clients: list[asyncio.Queue] = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    print("[App] Database initialized")
    yield


app = FastAPI(title="Calling Agent", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/ws/call")
async def ws_call(websocket: WebSocket):
    await handle_call(websocket)


@app.get("/api/bookings")
async def get_bookings(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Booking).order_by(Booking.created_at.desc()))
    bookings = result.scalars().all()
    return [b.to_dict() for b in bookings]


@app.get("/api/bookings/sse")
async def bookings_sse():
    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue()
        sse_clients.append(queue)
        try:
            while True:
                data = await queue.get()
                yield f"data: {json.dumps(data)}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            if queue in sse_clients:
                sse_clients.remove(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


async def broadcast_booking(booking_dict: dict):
    for queue in sse_clients:
        await queue.put(booking_dict)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
