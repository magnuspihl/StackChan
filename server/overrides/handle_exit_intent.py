# Kit override of plugins_func/functions/handle_exit_intent.py.
# Changes from upstream: English descriptions and default goodbye, and the
# device is sent the "sleepy" emotion so StackChan's firmware shows its sleep
# face and lowers its head while saying goodbye.
import asyncio

from plugins_func.register import register_function, ToolType, ActionResponse, Action
from config.logger import setup_logging
from core.utils import textUtils
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.connection import ConnectionHandler

TAG = __name__
logger = setup_logging()

handle_exit_intent_function_desc = {
    "type": "function",
    "function": {
        "name": "handle_exit_intent",
        "description": "Call when the user wants to end the conversation, says goodbye, or tells you to go to sleep.",
        "parameters": {
            "type": "object",
            "properties": {
                "say_goodbye": {
                    "type": "string",
                    "description": "A short, friendly goodbye to say before going to sleep.",
                }
            },
            "required": ["say_goodbye"],
        },
    },
}


@register_function(
    "handle_exit_intent", handle_exit_intent_function_desc, ToolType.SYSTEM_CTL
)
def handle_exit_intent(conn: "ConnectionHandler", say_goodbye: str | None = None):
    try:
        if say_goodbye is None:
            say_goodbye = "Goodnight!"
        if not conn.close_after_chat:
            conn.close_after_chat = True
        if conn.loop is not None:
            # "😴" maps to the "sleepy" emotion in textUtils.EMOJI_MAP.
            asyncio.run_coroutine_threadsafe(textUtils.get_emotion(conn, "😴"), conn.loop)
        logger.bind(tag=TAG).info(f"Exit intent handled: {say_goodbye}")
        return ActionResponse(
            action=Action.RESPONSE, result="Exit intent handled", response=say_goodbye
        )
    except Exception as e:
        logger.bind(tag=TAG).error(f"Exit intent failed: {e}")
        return ActionResponse(action=Action.NONE, result="Exit intent failed", response="")
