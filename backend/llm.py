import os
import json
from typing import Optional
from openai import AsyncOpenAI
from dotenv import load_dotenv
from config_loader import get_config

load_dotenv()
client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

_config = get_config()
restaurant = _config["restaurant"]
menu_text = "\n".join(
    f"- {item['name']} (${item['price']:.2f}): {item['description']}"
    for item in restaurant["menu"]
)
hours_text = "\n".join(
    f"  {day.capitalize()}: {hours}"
    for day, hours in restaurant["hours"].items()
)

SYSTEM_PROMPT = f"""You are a friendly, professional restaurant receptionist for "{restaurant['name']}", an {restaurant['cuisine']} restaurant.
Address: {restaurant['address']}
Phone: {restaurant['phone']}

RESTAURANT HOURS:
{hours_text}

MENU:
{menu_text}

BOOKING RULES:
- Maximum {restaurant['booking']['max_guests_per_table']} guests per table
- Table slots are {restaurant['booking']['slot_duration_minutes']} minutes each
- Must collect: name, contact number, number of guests, date, time
- Optional: food pre-order, special requests, payment method

YOUR BEHAVIOR:
1. Greet warmly. Ask if they want to book a table or place a takeaway order.
2. Collect required information naturally through conversation. Do NOT ask for everything in one long list.
3. Ask one or two questions per turn.
4. When collecting date/time, confirm which day of the week it falls on.
5. For food orders, suggest items from the menu by name. Mention the price when they ask or when confirming order.
6. Payment options: card at arrival, cash, or online payment.
7. When you have all required info, read back a summary and ask for confirmation.
8. Call the "extract_booking" function ONLY when you have all required fields (name, contact, guests, date, time).
9. Call the "confirm_booking" function ONLY after the customer confirms the summary.
10. If they need to cancel or modify, be helpful.
11. Be patient and friendly. If the customer struggles, help them.
12. If the customer asks about items not on the menu, politely explain what IS available.
13. Keep responses concise - 1 to 3 sentences per turn.
"""

FUNCTIONS = [
    {
        "type": "function",
        "function": {
            "name": "extract_booking",
            "description": "Extract structured booking details collected during the conversation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "customer_name": {"type": "string", "description": "Full name of the customer"},
                    "contact_number": {"type": "string", "description": "Phone number"},
                    "guest_count": {"type": "integer", "description": "Number of guests/people"},
                    "date": {
                        "type": "string",
                        "description": "Booking date in YYYY-MM-DD format",
                    },
                    "time": {
                        "type": "string",
                        "description": "Booking time in HH:MM 24-hour format",
                    },
                    "special_requests": {
                        "type": "string",
                        "description": "Any special requests or requirements (optional)",
                    },
                    "food_order": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "item": {"type": "string"},
                                "quantity": {"type": "integer"},
                                "price": {"type": "number"},
                            },
                            "required": ["item", "quantity", "price"],
                        },
                        "description": "Pre-ordered food items with quantities and prices",
                    },
                    "payment_method": {
                        "type": "string",
                        "enum": ["card_at_arrival", "online", "cash"],
                        "description": "Chosen payment method",
                    },
                },
                "required": ["customer_name", "contact_number", "guest_count", "date", "time"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "confirm_booking",
            "description": "Customer has confirmed the booking summary. Finalize the booking.",
            "parameters": {
                "type": "object",
                "properties": {
                    "confirmed": {"type": "boolean", "const": True},
                },
                "required": ["confirmed"],
            },
        },
    },
]

MESSAGES_TEMPLATE = [{"role": "system", "content": SYSTEM_PROMPT}]


class LLMAgent:
    def __init__(self):
        self.messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    def add_user_message(self, text: str):
        self.messages.append({"role": "user", "content": text})

    async def get_response(self) -> dict:
        """Returns dict with keys: text, extracted_booking, confirmed, done"""
        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=self.messages,
            tools=FUNCTIONS,
            tool_choice="auto",
            temperature=0.7,
            max_tokens=200,
        )

        choice = response.choices[0]
        result = {"text": None, "extracted_booking": None, "confirmed": False, "done": False}

        if choice.message.content:
            text = choice.message.content.strip()
            result["text"] = text
            self.messages.append({"role": "assistant", "content": text})
            return result

        if choice.message.tool_calls:
            for tool_call in choice.message.tool_calls:
                func_name = tool_call.function.name
                args = json.loads(tool_call.function.arguments)
                self.messages.append({
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": tool_call.id,
                            "type": "function",
                            "function": {"name": func_name, "arguments": json.dumps(args)},
                        }
                    ],
                })

                if func_name == "extract_booking":
                    result["extracted_booking"] = args
                    self.messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": json.dumps({"status": "received", "message": "Booking details captured. Present summary to customer for confirmation."}),
                    })

                elif func_name == "confirm_booking":
                    result["confirmed"] = True
                    result["done"] = True
                    self.messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": json.dumps({"status": "confirmed", "message": "Booking confirmed and saved."}),
                    })

            return result

        return result
