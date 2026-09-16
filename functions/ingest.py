import os
import re
import time
from pinecone import Pinecone
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_core.documents import Document
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# 1. SETUP ---------------------------------------------------------
PINECONE_API_KEY = os.environ.get("PINECONE_API_KEY")
GOOGLE_API_KEY = os.environ.get("GEMINI_API_KEY")
INDEX_NAME = "food-label-app"

if not PINECONE_API_KEY:
    raise ValueError("PINECONE_API_KEY not found in .env file.")
if not GOOGLE_API_KEY:
    raise ValueError("GEMINI_API_KEY not found in .env file.")

# Initialize Pinecone
pc = Pinecone(api_key=PINECONE_API_KEY)
index = pc.Index(INDEX_NAME)

# Initialize Google Embeddings
embeddings = GoogleGenerativeAIEmbeddings(
    model="gemini-embedding-001", # Updated to the standard embedding model
    google_api_key=GOOGLE_API_KEY
)

# 2. PROCESS PDF
print("Loading PDF...")
loader = PyPDFLoader(r"D:\Projects\urop\public\food_regulations.pdf") 
pages = loader.load()

# Combine all pages into one giant string of text first
full_text = "\n".join([page.page_content for page in pages])

print("Cleaning PDF noise...")
# Remove repeating headers/footers that confuse the AI
clean_text = re.sub(r"--- PAGE \d+ ---", "", full_text)
clean_text = re.sub(r"Updated until December 2023", "", clean_text)

print("Applying Structural Chunking...")
# Magic Regex: Splits the text right BEFORE the word "Regulation [Number]."
# so the word "Regulation" stays glued to the chunk!
raw_regulation_chunks = re.split(r"(?=Regulation\s+\d+[a-zA-Z]*\.)", clean_text)

# FIXED CHAR SPLITTING
splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=150,
    separators=[" ", ""]
)

baseline_chunks = splitter.split_text(full_text)
print(f"Fixed splitting: {len(baseline_chunks)} chunks")

## SENTENCE BASED
splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=150,
    separators=["\n\n", "\n", ". ", " "]
)

sentence_chunks = splitter.split_text(full_text)
print(f"Sentence splitting: {len(sentence_chunks)} chunks")

# Setup a sub-splitter just in case a single regulation is massive
sub_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000, 
    chunk_overlap=150,
    separators=["\n\n", "\n", ".", " "]
)

final_chunks = []

for chunk in raw_regulation_chunks:
    chunk = chunk.strip()
    
    # Ignore empty chunks or the table of contents
    if len(chunk) < 50 or not chunk.startswith("Regulation"):
        continue

    # Extract the exact Regulation Number and Title to use as Metadata
    # Looks for e.g., "Regulation 135. Flour confection."
    match = re.search(r"^Regulation\s+(\d+[a-zA-Z]*)\.\s*(.*?)\.", chunk)
    
    reg_num = "Unknown"
    reg_title = "Unknown"

    if match:
        reg_num = match.group(1) # Gets "135" or "134A"
        reg_title = match.group(2).strip() # Gets "Flour confection"

    # If the regulation is huge, split it further, but KEEP the metadata attached
    sub_chunks = sub_splitter.split_text(chunk)
    
    for sub_chunk in sub_chunks:
        doc = Document(
            page_content=sub_chunk,
            metadata={
                "regulation_number": reg_num,
                "title": reg_title,
                "source": "Malaysia Food Regulations 1985"
            }
        )
        final_chunks.append(doc)

print(f"Total chunks created: {len(final_chunks)}")
# Calculate average chunk size
total_tokens = 0
for chunk in final_chunks:
    tokens = len(chunk.page_content.split())  # rough estimate
    total_tokens += tokens

avg_chunk_size = total_tokens / len(final_chunks)
print(f"Average chunk size: {avg_chunk_size} tokens\n")

# 3. UPSERT TO PINECONE --------------------------------------------
print("Generating embeddings and uploading to Pinecone...")

batch_size = 10 

for i in range(0, len(final_chunks), batch_size):
    batch = final_chunks[i:i+batch_size]
    
    ids = [f"chunk_{i+j}" for j in range(len(batch))]
    texts = [chunk.page_content for chunk in batch]
    
    try:
        embeds = embeddings.embed_documents(texts)
        
        to_upsert = []
        for _id, _vector, _chunk in zip(ids, embeds, batch):
            to_upsert.append({
                "id": _id, 
                "values": _vector, 
                # We inject the extracted metadata directly into Pinecone here!
                "metadata": {
                    "text": _chunk.page_content,
                    "regulation_number": _chunk.metadata["regulation_number"],
                    "title": _chunk.metadata["title"],
                    "source": _chunk.metadata["source"]
                }
            })
        
        index.upsert(vectors=to_upsert)
        print(f"Uploaded chunks {i} to {i+len(batch)}")
        
        time.sleep(10) 
        
    except Exception as e:
        print(f"Error on chunk {i}: {e}. Pausing for 30 seconds...")
        time.sleep(30)

print("Done!")