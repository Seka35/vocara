import os
import glob
import numpy as np
from PIL import Image
import onnxruntime as ort

import cv2

def process_real_photo(photo_path, img_size=(128, 128)):
    try:
        # Read image
        img_bgr = cv2.imread(photo_path)
        if img_bgr is None:
            return None
        
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        
        # Otsu Adaptive Binarization to strip all background textures (checkered, skin, glare)
        # Keeps only black/dark tattoo waveform bars
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        _, thresh = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        # Find contours of waveform bars
        inv_thresh = cv2.bitwise_not(thresh)
        contours, _ = cv2.findContours(inv_thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        if contours:
            all_pts = np.vstack([c for c in contours if cv2.contourArea(c) > 5])
            if len(all_pts) > 0:
                x, y, w, h = cv2.boundingRect(all_pts)
                margin_x = int(w * 0.05)
                margin_y = int(h * 0.05)
                x1 = max(0, x - margin_x)
                y1 = max(0, y - margin_y)
                x2 = min(thresh.shape[1], x + w + margin_x)
                y2 = min(thresh.shape[0], y + h + margin_y)
                thresh = thresh[y1:y2, x1:x2]

        # Resize normalized binarized waveform to 128x128
        resized = cv2.resize(thresh, img_size, interpolation=cv2.INTER_AREA)
        
        img_np = resized.astype(np.float32)
        # Normalize to [-1, 1] tensor shape (1, 1, 128, 128)
        tensor = (img_np / 255.0 - 0.5) / 0.5
        tensor = np.expand_dims(np.expand_dims(tensor, axis=0), axis=0)
        return tensor
    except Exception as e:
        print(f"⚠️ Error reading photo {photo_path}: {e}")
        return None

def benchmark_real_photos():
    onnx_path = "public/models/vocara_embed.onnx"
    photos_dir = "test_real_photos"
    os.makedirs(photos_dir, exist_ok=True)

    if not os.path.exists(onnx_path):
        print(f"❌ Error: ONNX model not found at {onnx_path}.")
        return

    session = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])
    input_name = session.get_inputs()[0].name

    photo_files = glob.glob(os.path.join(photos_dir, "*.[jJ][pP][gG]")) + \
                  glob.glob(os.path.join(photos_dir, "*.[pP][nN][gG]")) + \
                  glob.glob(os.path.join(photos_dir, "*.[wW][eE][bB][pP]"))

    print("\n" + "="*80)
    print(" 📸 VOCARA REAL PHONE PHOTO EVALUATION HARNESS ")
    print("="*80)

    if len(photo_files) == 0:
        print(f"📁 Place your 15-20 real phone photos (JPG/PNG/WEBP) in folder: [{os.path.abspath(photos_dir)}]")
        print("   Then re-run: ./venv/bin/python benchmark_real_photos.py")
        print("="*80 + "\n")
        return

    print(f"🔍 Found {len(photo_files)} real photos in [{photos_dir}]. Extracting embeddings...\n")
    photo_embeddings = {}
    for ppath in photo_files:
        pname = os.path.basename(ppath)
        tensor = process_real_photo(ppath)
        if tensor is not None:
            emb = session.run(None, {input_name: tensor})[0][0]
            photo_embeddings[pname] = emb
            print(f"  • Processed: {pname:<30} -> Embedding extracted.")

    print("\n📊 CROSS-PHOTO SIMILARITY MATRIX:")
    print("-" * 60)
    names = list(photo_embeddings.keys())
    for i in range(len(names)):
        emb_i = photo_embeddings[names[i]]
        for j in range(i + 1, len(names)):
            emb_j = photo_embeddings[names[j]]
            sim = np.dot(emb_i, emb_j)
            print(f"  [{names[i]:<20}] vs [{names[j]:<20}] -> Similarity = {sim*100:.1f}%")

    print("\n" + "="*80)
    print(" ✅ REAL PHOTO EVALUATION COMPLETE ")
    print("="*80 + "\n")

if __name__ == "__main__":
    benchmark_real_photos()
