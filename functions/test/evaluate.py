import os
import time
from google import genai
import firebase_admin
from firebase_admin import credentials, firestore
from dotenv import load_dotenv

load_dotenv()

# --- 1. SETUP FIREBASE ---
SERVICE_ACCOUNT_PATH = os.environ["GOOGLE_APPLICATION_CREDENTIALS"]

# Initialize Firebase only if it hasn't been initialized yet
if not firebase_admin._apps:
    cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
    firebase_admin.initialize_app(cred)

db = firestore.client()

# --- 2. SETUP GEMINI ---
gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
GENERATOR_MODEL = 'gemini-2.5-flash'

# --- 3. GENERATION FUNCTION ---
def generate_ideal_ground_truth(question, context):
    """Prompts Gemini to act as the ultimate expert and write the perfect answer key."""
    prompt = f"""
    You are an expert legal analyst creating a "Ground Truth" answer key for a RAG system evaluating the Malaysian Food Regulations 1985.

    Question: "{question}"
    Legal Context: "{context}"

    Task: Write the perfect, 100% factual, and concise answer to the question using ONLY the provided context.
    - Your answer should be a complete, natural-sounding sentence.
    - Do not add any outside knowledge.
    - If the context does not contain the answer at all, explicitly state: "The provided context does not contain the answer to this question."

    Return ONLY the ideal answer text. Do not include formatting or introductory phrases.
    """
    try:
        response = gemini_client.models.generate_content(
            model=GENERATOR_MODEL,
            contents=prompt
        )
        return response.text.strip()
    except Exception as e:
        print(f"Error generating ground truth: {e}")
        return ""

# --- 4. MAIN FIRESTORE LOOP ---
def auto_fill_ground_truths():
    print("Connecting to Firestore...")
    eval_ref = db.collection('rag_evaluations')

    # Fetch all documents in the collection
    docs = eval_ref.stream()

    updated_count = 0

    for doc in docs:
        data = doc.to_dict()

        # Check if ground truth is completely missing or just an empty string
        if not data.get("ground_truth") or str(data.get("ground_truth")).strip() == "":
            question = data.get("question", "No question")
            context = data.get("context", "No context")

            print(f"\nProcessing Document ID: {doc.id}")
            print(f"Question: {question}")

            # Generate the perfect answer using Gemini
            ideal_answer = generate_ideal_ground_truth(question, context)

            if ideal_answer:
                print(f"Generated GT: {ideal_answer}")

                # Update the specific document in Firestore with the new answer
                doc.reference.update({"ground_truth": ideal_answer})
                updated_count += 1

                # Sleep to respect API rate limits
                time.sleep(2)
            else:
                print("Failed to generate an answer for this document.")

    print(f"\nDone! Automatically filled {updated_count} missing ground truths in Firestore.")

if __name__ == "__main__":
    auto_fill_ground_truths()