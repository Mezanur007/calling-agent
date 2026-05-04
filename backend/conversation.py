import json
from typing import Optional


class ConversationManager:
    def __init__(self):
        self.booking = None
        self.confirmed = False
        self.done = False
        self.transcript: list[str] = []

    def add_to_transcript(self, speaker: str, text: str):
        self.transcript.append(f"{speaker}: {text}")

    def set_booking(self, booking_data: dict):
        self.booking = booking_data

    def get_booking_summary(self) -> str:
        if not self.booking:
            return "No booking data."
        b = self.booking
        lines = []
        lines.append(f"- Name: {b.get('customer_name', 'N/A')}")
        lines.append(f"- Contact: {b.get('contact_number', 'N/A')}")
        lines.append(f"- Guests: {b.get('guest_count', 'N/A')}")
        lines.append(f"- Date: {b.get('date', 'N/A')}")
        lines.append(f"- Time: {b.get('time', 'N/A')}")
        if b.get("special_requests"):
            lines.append(f"- Special requests: {b['special_requests']}")
        if b.get("food_order"):
            items = ", ".join(
                f"{f['quantity']}x {f['item']}" for f in b["food_order"]
            )
            lines.append(f"- Food order: {items}")
        if b.get("payment_method"):
            lines.append(f"- Payment: {b['payment_method']}")
        return "\n".join(lines)

    def get_transcript_text(self) -> str:
        return "\n".join(self.transcript)
