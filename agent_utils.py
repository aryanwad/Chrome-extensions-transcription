# agent_utils.py
#
# Uses OpenAI Python SDK v1.x with a hard‑coded key.
# Before running, install:
#     pip install openai

import os
from openai import OpenAI
from config import OPENAI_API_KEY

# ───────── CONFIG ─────────
client = OpenAI(
    api_key=OPENAI_API_KEY
)
TRANSCRIPT_FILE = "full_transcript.txt"

def load_transcript(path=TRANSCRIPT_FILE) -> str:
    if not os.path.exists(path):
        raise FileNotFoundError(f"No transcript found at: {path}")
    with open(path, "r", encoding="utf-8") as f:
        return f.read().strip()

def ask_question(question: str) -> str:
    transcript = load_transcript()
    messages = [
        {
            "role": "system",
            "content": (
                "You are a thoughtful and helpful assistant. "
                "Provide answers that are clear, well-organized, and easy to understand. "
                "Feel free to use paragraphs or bullet points if needed. "
                "Format your output for clean visual display in a small UI window."
            )
        },
        {
            "role": "user",
            "content": (
                "Here is the transcript of a session:\n\n"
                f"{transcript}\n\n"
                f"User question: {question}\n"
                "Please answer in a helpful, organized, and readable manner."
            )
        }
    ]
    resp = client.chat.completions.create(
        model="gpt-4",
        messages=messages,
        temperature=0.5,
        max_tokens=500  # allows more detailed answers
    )
    return resp.choices[0].message.content.strip()

def summarize_transcript() -> str:
    transcript = load_transcript()
    messages = [
        {
            "role": "system",
            "content": (
                "You are a helpful assistant. Summarize the transcript below using bullet points or concise paragraphs. "
                "Your summary should highlight the most important points clearly."
            )
        },
        {
            "role": "user",
            "content": f"Summarize the key points from this transcript:\n\n{transcript}"
        }
    ]
    resp = client.chat.completions.create(
        model="gpt-4",
        messages=messages,
        temperature=0.5,
        max_tokens=500
    )
    return resp.choices[0].message.content.strip()

def draft_followup_email() -> str:
    transcript = load_transcript()
    messages = [
        {
            "role": "system",
            "content": (
                "You are an assistant that writes polished, professional emails. "
                "Based on the transcript, write a concise follow-up email that sounds natural and friendly."
            )
        },
        {
            "role": "user",
            "content": f"Based on this transcript, draft a concise follow-up email:\n\n{transcript}"
        }
    ]
    resp = client.chat.completions.create(
        model="gpt-4",
        messages=messages,
        temperature=0.4,
        max_tokens=400
    )
    return resp.choices[0].message.content.strip()

def main():
    menu = """
Agent Menu:
  1) Ask a question
  2) Summarize transcript
  3) Draft follow-up email
  q) Quit
Enter choice: """
    while True:
        try:
            choice = input(menu).strip().lower()
        except EOFError:
            print("\n📴 Input closed. Exiting.")
            break
        if choice == "1":
            q = input("Enter your question: ").strip()
            print("\n📝 AI Answer:\n")
            print(ask_question(q))
        elif choice == "2":
            print("\n📝 Summary:\n")
            print(summarize_transcript())
        elif choice == "3":
            print("\n📝 Draft Email:\n")
            print(draft_followup_email())
        elif choice == "q":
            print("Goodbye!")
            break
        else:
            print("Invalid choice, please try again.")
