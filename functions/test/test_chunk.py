import os
import re
import numpy as np
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from dotenv import load_dotenv
import random
from google import genai
import time

load_dotenv()

# --- 1. SETUP & CONFIGURATION ---
GOOGLE_API_KEY = os.environ.get("GEMINI_API_KEY")
PDF_PATH = r"D:\Projects\urop\public\food_regulations.pdf"

print("Initializing Embeddings...")
embeddings = GoogleGenerativeAIEmbeddings(
    model="gemini-embedding-001",
    google_api_key=GOOGLE_API_KEY
)

# --- 2. LOAD AND SPLIT DATA (All 3 Strategies) ---
print("Loading PDF...")
loader = PyPDFLoader(PDF_PATH)
pages = loader.load()
full_text = "\n".join([page.page_content for page in pages])

# Clean Text
clean_text = re.sub(r"--- PAGE \d+ ---", "", full_text)
clean_text = re.sub(r"Updated until December 2023", "", clean_text)

print("Applying Chunking Strategies...")

# Strategy 1: Fixed Character
fixed_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=150, separators=[" ", ""])
fixed_chunks = fixed_splitter.create_documents([clean_text])

# Strategy 2: Sentence-Based
sentence_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=150, separators=["\n\n", "\n", ". ", " "])
sentence_chunks = sentence_splitter.create_documents([clean_text])

# Strategy 3: Semantic Regex (Your Custom Logic)
raw_regulation_chunks = re.split(r"(?=Regulation\s+\d+[a-zA-Z]*\.)", clean_text)
sub_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=150, separators=["\n\n", "\n", ".", " "])
semantic_chunks = []

for chunk in raw_regulation_chunks:
    chunk = chunk.strip()
    if len(chunk) < 50 or not chunk.startswith("Regulation"):
        continue
    sub_chunks = sub_splitter.split_text(chunk)
    for sub_chunk in sub_chunks:
        semantic_chunks.append(Document(page_content=sub_chunk))

# --- 3. METRIC FUNCTIONS ---

def calculate_avg_chunk_size(chunks):
    """Calculates average word count per chunk."""
    total_words = sum(len(chunk.page_content.split()) for chunk in chunks)
    return int(total_words / len(chunks))

import random
from google import genai

# Initialize the new Gemini client for the judge
gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

def evaluate_context_retention_with_llm(chunks, sample_size=15):
    """
    Uses Gemini to grade a random sample of chunks on a scale of 1-10
    based on how well they retain semantic context.
    """
    if not chunks:
        return 0.0

    # Sample chunks to save time and API calls
    sample = random.sample(chunks, min(len(chunks), sample_size))
    total_score = 0

    prompt_template = """
    You are an expert legal document analyzer evaluating a RAG pipeline.
    Read the following extracted text chunk from the Malaysian Food Regulations 1985.

    Rate this chunk on a scale of 1 to 10 based on its "Context Retention".
    - Score 9-10: The chunk is a complete, self-contained thought. Legal conditions and exceptions are kept together.
    - Score 5-8: The chunk is mostly readable, but might start abruptly or miss a minor piece of surrounding context.
    - Score 1-4: The chunk starts or ends mid-sentence, cuts off a crucial legal definition, or is completely unreadable.

    Return ONLY a single integer from 1 to 10. Do not include any other text.

    Text Chunk:
    "{chunk_text}"
    """

    print(f"  Grading {len(sample)} chunks with Gemini...")

    for chunk in sample:
        prompt = prompt_template.format(chunk_text=chunk.page_content)

        try:
            response = gemini_client.models.generate_content(
                model='gemini-2.5-flash',
                contents=prompt
            )

            # Clean the response to ensure we just get the integer
            score_str = response.text.strip()
            match = re.search(r'\d+', score_str)

            if match:
                score = int(match.group())
                score = max(1, min(10, score)) # Clamp between 1 and 10
                total_score += score
            else:
                total_score += 5 # Neutral fallback if LLM returns weird text

            # Quick sleep to respect API rate limits
            time.sleep(1)

        except Exception as e:
            print(f"  [!] LLM Judge Error: {e}")
            total_score += 5

    # Return the average score out of 10
    return total_score / len(sample)

def evaluate_retrieval_accuracy(vectorstore, qa_pairs, k=3):
    """Tests if the vector store retrieves the target keyword in the top K results."""
    correct_retrievals = 0

    for question, expected_keyword in qa_pairs:
        results = vectorstore.similarity_search(question, k=k)
        retrieved_texts = " ".join([res.page_content.lower() for res in results])

        if expected_keyword.lower() in retrieved_texts:
            correct_retrievals += 1

    return (correct_retrievals / len(qa_pairs)) * 100

# --- 4. BUILD LOCAL VECTOR STORES ---
print("\nBuilding Local Vector Stores (This will take a moment)...")

# This is where we actually embed the chunks and store them in FAISS
stores = {
    "Fixed Character": FAISS.from_documents(fixed_chunks, embeddings),
    "Sentence-Based": FAISS.from_documents(sentence_chunks, embeddings),
    "Semantic Regex": FAISS.from_documents(semantic_chunks, embeddings)
}

chunk_data = {
    "Fixed Character": fixed_chunks,
    "Sentence-Based": sentence_chunks,
    "Semantic Regex": semantic_chunks
}

# The questions we will use to test retrieval accuracy
test_qa_pairs = [
    ("What are the standards for flour confection?", "regulation 135"),
    ("What is the maximum permitted proportion of lead in food?", "fourteenth schedule"),
    ("What are the labeling requirements for artificial sweetening?", "regulation 18"),
    ("What defines a milk product?", "regulation 82"),
    ("Are there restrictions on adding vitamins to food?", "regulation 26")
]

results = []

for strategy_name in stores.keys():
    print(f"\nEvaluating: {strategy_name}")
    chunks = chunk_data[strategy_name]
    store = stores[strategy_name]

    total_chunks = len(chunks)
    avg_size = calculate_avg_chunk_size(chunks)

    # Using the new LLM Judge!
    context_ret_score = evaluate_context_retention_with_llm(chunks, sample_size=15)

    retrieval_acc = evaluate_retrieval_accuracy(store, test_qa_pairs, k=3)

    results.append({
        "Strategy": strategy_name,
        "Total Chunks": total_chunks,
        "Avg Chunk Size": f"{avg_size} words",
        "Context Retention": f"{context_ret_score:.1f} / 10", # Updated format
        "Retrieval Accuracy": f"{retrieval_acc:.1f}%"
    })

# --- PRINT RESULTS TABLE ---
print("\n" + "="*85)
print(f"{'Strategy':<25} | {'Total Chunks':<15} | {'Avg Chunk Size':<15} | {'Context Retention':<17} | {'Retrieval Accuracy':<15}")
print("-" * 85)
for res in results:
    print(f"{res['Strategy']:<25} | {res['Total Chunks']:<15} | {res['Avg Chunk Size']:<15} | {res['Context Retention']:<17} | {res['Retrieval Accuracy']:<15}")
print("="*85)