import os
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import onnxruntime as ort

def create_test_profile(peaks_config):
    bins = np.zeros(64)
    for center, width, height in peaks_config:
        for i in range(64):
            bins[i] += height * math.exp(-0.5 * ((i - center) / width) ** 2)
    max_val = np.max(bins)
    if max_val > 0:
        bins = bins / max_val
    return bins

def render_test_variation(bins, rotation_deg=0, blur_radius=0, brightness=1.0):
    W, H = 128, 128
    img = Image.new("L", (W, H), color=255)
    draw = ImageDraw.Draw(img)
    cy = H // 2
    bar_w = W // 64
    for i, val in enumerate(bins):
        x = i * bar_w + bar_w // 2
        bar_h = int(val * (H * 0.4))
        draw.line([(x, cy - bar_h), (x, cy + bar_h)], fill=25, width=2)
    draw.line([(0, cy), (W, cy)], fill=80, width=1)

    if rotation_deg != 0:
        img = img.rotate(rotation_deg, resample=Image.BICUBIC, expand=False, fillcolor=255)
    if blur_radius > 0:
        img = img.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    
    img_np = np.array(img, dtype=np.float32)
    img_np = np.clip(img_np * brightness, 0, 255).astype(np.uint8)
    
    # Normalize to [-1, 1] tensor shape (1, 1, 128, 128)
    tensor = (img_np.astype(np.float32) / 255.0 - 0.5) / 0.5
    tensor = np.expand_dims(np.expand_dims(tensor, axis=0), axis=0)
    return tensor

def run_scale_benchmark(num_sounds=100):
    onnx_path = "public/models/vocara_embed.onnx"
    if not os.path.exists(onnx_path):
        print(f"❌ Error: ONNX model not found at {onnx_path}. Train the model first.")
        return

    session = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])
    input_name = session.get_inputs()[0].name

    print("\n" + "="*80)
    print(f" 📊 VOCARA AI ONNX EMBEDDING SCALE BENCHMARK ({num_sounds} UNIQUE SOUND MOTIFS) ")
    print("="*80)

    # Generate 100 distinct waveform profiles (guaranteed unique seed per sound index)
    import random
    sounds = {}
    for s in range(num_sounds):
        rng = random.Random(2026 + s)
        num_peaks = rng.randint(2, 5)
        peaks = []
        for _ in range(num_peaks):
            c = rng.randint(6, 58)
            w = rng.uniform(2.0, 7.0)
            h = rng.uniform(0.3, 1.0)
            peaks.append((c, w, h))
        sounds[f"Sound_{s+1:03d}"] = create_test_profile(peaks)

    variations = [
        ("Base", 0, 0, 1.0),
        ("Rotated_15deg", 15, 0.5, 1.0),
        ("Rotated_-20deg", -20, 0.8, 0.9),
        ("Blurred_Glare", 5, 1.5, 1.2),
        ("Low_Light", -10, 1.0, 0.7)
    ]

    print(f"🔄 Extracting ONNX Embeddings for {num_sounds} sounds across {len(variations)} camera variations...")
    embeddings = {}
    for sound_name, bins in sounds.items():
        embeddings[sound_name] = []
        for var_name, rot, blur, bright in variations:
            inp = render_test_variation(bins, rotation_deg=rot, blur_radius=blur, brightness=bright)
            out = session.run(None, {input_name: inp})[0][0]
            embeddings[sound_name].append((var_name, out))

    # 1. Intra-Class Similarity Statistics (Same Sound under Camera Variations)
    intra_sims = []
    for sound_name in sounds.keys():
        base_emb = embeddings[sound_name][0][1]
        for var_name, var_emb in embeddings[sound_name][1:]:
            intra_sims.append(np.dot(base_emb, var_emb))

    # 2. Inter-Class Similarity Statistics (Different Sounds vs Each Other)
    sound_names = list(sounds.keys())
    inter_sims = []
    worst_inter_pair = ("", "", -1.0)
    
    for i in range(len(sound_names)):
        emb_i = embeddings[sound_names[i]][0][1]
        for j in range(i + 1, len(sound_names)):
            emb_j = embeddings[sound_names[j]][0][1]
            sim = np.dot(emb_i, emb_j)
            inter_sims.append(sim)
            if sim > worst_inter_pair[2]:
                worst_inter_pair = (sound_names[i], sound_names[j], sim)

    intra_arr = np.array(intra_sims) * 100
    inter_arr = np.array(inter_sims) * 100

    print("\n📈 STATISTICAL SUMMARY OF SCALE BENCHMARK:")
    print("-" * 60)
    print(f"  ✅ Intra-Class (Same Sound, 4 Camera Variations):")
    print(f"     • Mean Similarity : {np.mean(intra_arr):.2f}%")
    print(f"     • Min Similarity  : {np.min(intra_arr):.2f}%")
    print(f"     • Max Similarity  : {np.max(intra_arr):.2f}%")
    print(f"\n  ❌ Inter-Class (Different Sounds, {len(inter_sims)} Pairwise Comparisons):")
    print(f"     • Mean Similarity : {np.mean(inter_arr):.2f}%")
    print(f"     • Min Similarity  : {np.min(inter_arr):.2f}%")
    print(f"     • MAX (WORST-CASE) Inter-Class Similarity : {np.max(inter_arr):.2f}%")
    print(f"     • Worst Pair      : [{worst_inter_pair[0]}] vs [{worst_inter_pair[1]}] = {worst_inter_pair[2]*100:.2f}%")
    
    print("\n" + "="*80)
    print(" ✅ SCALE BENCHMARK EVALUATION COMPLETE ")
    print("="*80 + "\n")

if __name__ == "__main__":
    run_scale_benchmark(num_sounds=100)
