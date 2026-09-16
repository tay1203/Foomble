import os
import time
import json
import re
from collections import Counter
import jiwer
import pytesseract
from PIL import Image
from google.cloud import vision
from google import genai

# --- Configuration ---
pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
IMAGE_FOLDER = r"D:\Projects\urop\functions\test\test_dataset\images"
GROUND_TRUTH_FILE = r"D:\Projects\urop\functions\test\test_dataset\ground_truth.json"

# 1. Setup Google Cloud Vision
vision_client = vision.ImageAnnotatorClient()

# 2. Setup Gemini API
gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
GEMINI_MODEL_ID = 'gemini-2.5-flash'

# --- Metric Calculation Functions ---
def calculate_cer(reference, hypothesis):
    # (characters incorrect / total characters) * 100
    # Still useful to keep for evaluating pure character-level typos
    return jiwer.cer(reference, hypothesis) * 100

def calculate_word_overlap(reference, hypothesis):
    # Order-independent Word Accuracy (Bag of Words)
    ref_clean = re.sub(r'[^\w\s]', '', reference.lower())
    hyp_clean = re.sub(r'[^\w\s]', '', hypothesis.lower())

    ref_words = Counter(ref_clean.split())
    hyp_words = Counter(hyp_clean.split())

    # Count how many words match perfectly, regardless of order
    overlap = sum((ref_words & hyp_words).values())
    total_ref = sum(ref_words.values())

    if total_ref == 0:
        return 100.0

    return (overlap / total_ref) * 100

def calculate_extraction_accuracy(ground_truth_list, extracted_text):
    if not ground_truth_list:
        return 100.0

    extracted_text_lower = extracted_text.lower()
    correct_count = 0

    for item in ground_truth_list:
        if str(item).lower() in extracted_text_lower:
            correct_count += 1

    return (correct_count / len(ground_truth_list)) * 100

# --- Extraction Functions ---
def extract_tesseract(image_path):
    img = Image.open(image_path)
    start_time = time.time()
    text = pytesseract.image_to_string(img)
    process_time = time.time() - start_time
    return text, process_time

def extract_cloud_vision(image_path):
    with open(image_path, 'rb') as image_file:
        content = image_file.read()

    image = vision.Image(content=content)
    start_time = time.time()
    response = vision_client.document_text_detection(image=image)
    process_time = time.time() - start_time

    text = response.full_text_annotation.text if response.full_text_annotation else ""
    return text, process_time

def extract_gemini(image_path):
    img = Image.open(image_path)

    # We now force Gemini to return structured JSON
    prompt = """
    Analyze this food packaging image. Transcribe the text and extract key fields.
    Return ONLY a valid JSON object with the exact following structure:
    {
        "text": "All text transcribed from the package",
        "fields": ["List of main product fields like Name, Net Weight, Brand"],
        "nutrition": ["List of nutrition facts like Calories 150, Fat 2g"]
    }
    """

    start_time = time.time()
    response = gemini_client.models.generate_content(
        model=GEMINI_MODEL_ID,
        contents=[prompt, img],
        config={"response_mime_type": "application/json"}
    )
    process_time = time.time() - start_time

    return response.text, process_time

# --- Main Benchmarking Loop ---
def run_benchmark():
    with open(GROUND_TRUTH_FILE, 'r', encoding='utf-8') as f:
        ground_truth_data = json.load(f)

    engines = {
        "Tesseract": extract_tesseract,
        "Cloud Vision": extract_cloud_vision,
        "Gemini VLM": extract_gemini
    }

    # Replaced WER with Overlap
    results = {engine: {"cer": [], "overlap": [], "label_acc": [], "nutri_acc": [], "time": []} for engine in engines}

    image_files = os.listdir(IMAGE_FOLDER)[:25]
    print(f"Starting benchmark on {len(image_files)} images...\n")

    for img_file in image_files:
        if img_file not in ground_truth_data:
            continue

        img_path = os.path.join(IMAGE_FOLDER, img_file)
        gt = ground_truth_data[img_file]
        gt_text = gt.get("text", "")
        gt_fields = gt.get("fields", [])
        gt_nutrition = gt.get("nutrition", [])

        for engine_name, extract_func in engines.items():
            try:
                extracted_text, proc_time = extract_func(img_path)

                ref_text = gt_text.strip() or "empty"
                hyp_text = extracted_text.strip() or "empty"

                # Calculate Metrics
                cer = calculate_cer(ref_text, hyp_text)
                overlap = calculate_word_overlap(ref_text, hyp_text)
                label_acc = calculate_extraction_accuracy(gt_fields, hyp_text)
                nutri_acc = calculate_extraction_accuracy(gt_nutrition, hyp_text)

                # Store Results
                results[engine_name]["cer"].append(cer)
                results[engine_name]["overlap"].append(overlap)
                results[engine_name]["label_acc"].append(label_acc)
                results[engine_name]["nutri_acc"].append(nutri_acc)
                results[engine_name]["time"].append(proc_time)

            except Exception as e:
                print(f"Error processing {img_file} with {engine_name}: {e}")

    # --- Aggregate and Print Results ---
    print("-" * 80)
    print(f"{'Engine':<15} | {'CER (%)':<10} | {'Overlap (%)':<12} | {'Field Acc (%)':<14} | {'Nutri Acc (%)':<14} | {'Time (s)':<10}")
    print("-" * 80)

    for engine, metrics in results.items():
        avg_cer = sum(metrics["cer"]) / len(metrics["cer"]) if metrics["cer"] else 0
        avg_overlap = sum(metrics["overlap"]) / len(metrics["overlap"]) if metrics["overlap"] else 0
        avg_label = sum(metrics["label_acc"]) / len(metrics["label_acc"]) if metrics["label_acc"] else 0
        avg_nutri = sum(metrics["nutri_acc"]) / len(metrics["nutri_acc"]) if metrics["nutri_acc"] else 0
        avg_time = sum(metrics["time"]) / len(metrics["time"]) if metrics["time"] else 0

        print(f"{engine:<15} | {avg_cer:<10.2f} | {avg_overlap:<12.2f} | {avg_label:<14.2f} | {avg_nutri:<14.2f} | {avg_time:<10.2f}")

if __name__ == "__main__":
    run_benchmark()