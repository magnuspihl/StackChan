"""Apply the kit's string patches to xiaozhi-esp32-server at image build time.

Upstream hardcodes Chinese text in places that reach the user or the model
(injected few-shot dialogues, a virtual tool description, fallback errors), and
matches exit phrases case- and space-sensitively. Each patch below replaces one
exact string and fails the build if that string is missing, so an upstream
change is noticed instead of silently shipping Chinese again.
"""
import sys
from pathlib import Path

ROOT = Path("/opt/xiaozhi-esp32-server")

PATCHES = [
    # --- core/connection.py: the virtual "direct_answer" routing tool ---------
    ("core/connection.py",
     '"description": "当用户的请求不匹配其他任何工具时，可用此选项直接回复。将回复内容写在response参数里。",',
     '"description": "Use this to reply directly when the request does not match any other tool. Put the full reply in the response parameter.",'),
    ("core/connection.py",
     '"description": "你回复用户的完整内容",',
     '"description": "Your complete reply to the user",'),

    # --- core/connection.py: few-shot examples injected into every session ----
    ("core/connection.py",
     'Message(role="user", content="给我讲个故事吧", is_temporary=True)',
     'Message(role="user", content="Tell me a story", is_temporary=True)'),
    ("core/connection.py",
     '{"response": "好呀，你想听什么类型的呀？童话、冒险还是搞笑的？选一个我给你开讲~"}',
     '{"response": "Sure! A fairy tale, an adventure, or something funny?"}'),
    ("core/connection.py",
     'content="已直接回复", is_temporary=True,',
     'content="Replied directly", is_temporary=True,'),
    ("core/connection.py",
     'Message(role="user", content="拜拜", is_temporary=True)',
     'Message(role="user", content="Bye bye", is_temporary=True)'),
    ("core/connection.py",
     '{"say_goodbye": "再见，下次再聊~"}',
     '{"say_goodbye": "Goodnight, talk soon!"}'),
    ("core/connection.py",
     'content="退出意图已处理", is_temporary=True,',
     'content="Exit intent handled", is_temporary=True,'),
    ("core/connection.py",
     'role="assistant", content="再见，下次再聊~", is_temporary=True,',
     'role="assistant", content="Goodnight, talk soon!", is_temporary=True,'),

    # --- core/connection.py: spoken fallback when the LLM call fails ----------
    ("core/connection.py",
     'result="哎呀，网络遇到点问题，请稍后再试下！"',
     'result="Oops, I can\'t reach my brain right now. Please try again in a moment."'),

    # --- core/handle/intentHandler.py: exit phrases ---------------------------
    # The ASR text is stripped of punctuation AND spaces before comparing, so
    # compare the configured phrase the same way, and ignore case. Still a
    # whole-utterance match: "go to sleep" inside a longer sentence won't exit.
    ("core/handle/intentHandler.py",
     "        if text == cmd:",
     "        if text.lower() == remove_punctuation_and_length(cmd)[1].lower():"),
]


def main() -> int:
    failed = 0
    for rel, old, new in PATCHES:
        path = ROOT / rel
        src = path.read_text(encoding="utf-8")
        count = src.count(old)
        if count != 1:
            print(f"PATCH FAILED ({count} matches) in {rel}: {old[:70]!r}", file=sys.stderr)
            failed += 1
            continue
        path.write_text(src.replace(old, new), encoding="utf-8")
        print(f"patched {rel}: {old[:50]!r}")
    if failed:
        print(f"{failed} patch(es) did not apply; upstream changed. Update server/patches.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
