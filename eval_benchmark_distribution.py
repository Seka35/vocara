import os
import random
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import onnxruntime as ort

def create_test_profile(peaks):
    bins = np.zeros(64)
    for center, width, height in peaks:
        for i in range(64):
            bins[i] += height * math.exp(-0.5 * ((i - center) / width) ** 2)
    max_val = np.max(bins)
    if max_val > 0:
        bins = bins / max_val
    return bins

def render_test_variation(bins, rotation_deg=0, blur_radius=0):
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
    tensor = (img_np / 255.0 - 0.5) / 0.5
    tensor = np.expand_dims(np.expand_dims(tensor, axis=0), axis=0)
    return tensor

def eval_distribution_scale():
    onnx_path = "public/models/vocara_embed.onnx"
    if not os.path.exists(onnx_path):
        print(f"❌ Error: ONNX model not found at {onnx_path}.")
        return

    session = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])
    input_name = session.get_inputs()[0].name

    print("\n" + "="*80)
    print(" 📊 EVALUATION DU MODE 1 : RECHERCHE RESTREINTE AU COMPTE CLIENT (N = 3 à 10 SONS) ")
    print("="*80)

    for num_sounds in [3, 5, 10]:
        sounds = {}
        embeddings = {}
        for s in range(num_sounds):
            rng = random.Random(5000 + s)
            num_peaks = rng.randint(2, 5)
            peaks = []
            for _ in range(num_peaks):
                c = rng.randint(6, 58)
                w = rng.uniform(2.0, 7.0)
                h = rng.uniform(0.3, 1.0)
                peaks.append((c, w, h))
            profile = create_test_profile(peaks)
            sounds[f"Sound_{s+1:02d}"] = profile
            
            tensor = render_test_variation(profile, rotation_deg=0, blur_radius=0)
            emb = session.run(None, {input_name: tensor})[0][0]
            embeddings[f"Sound_{s+1:02d}"] = emb

        sound_names = list(embeddings.keys())
        net_winners = 0
        ambiguous_collisions = 0
        no_matches = 0

        # Test 100 random scans across these user sounds
        for t in range(100):
            target_name = sound_names[t % len(sound_names)]
            target_profile = sounds[target_name]
            query_tensor = render_test_variation(target_profile, rotation_deg=rng.randint(-15, 15), blur_radius=0.5)
            query_emb = session.run(None, {input_name: query_tensor})[0][0]

            scores = []
            for db_name in sound_names:
                sim = np.dot(query_emb, embeddings[db_name])
                scores.append((db_name, sim))
            
            scores.sort(key=lambda x: x[1], reverse=True)

            top_score = scores[0][1]
            runner_up_score = scores[1][1] if len(scores) > 1 else 0.0
            margin = top_score - runner_up_score

            if top_score >= 0.80:
                if margin >= 0.15 or len(scores) == 1:
                    net_winners += 1
                else:
                    ambiguous_collisions += 1
            else:
                no_matches += 1

        total = 100
        print(f"\n👤 Compte Client : {num_sounds} Tatouages Enregistrés (100 Scans Testés)")
        print(f"  • Scénario 1 [Net Winner Direct (>80% & Marge >= 15%)] : {net_winners} ({net_winners/total*100:.1f}%)")
        print(f"  • Scénario 2 [Collision Ambiguë (>80% mais Marge < 15%)]  : {ambiguous_collisions} ({ambiguous_collisions/total*100:.1f}%)")
        print(f"  • Scénario 3 [Échec / Trop Faible (<80%)]                 : {no_matches} ({no_matches/total*100:.1f}%)")
    
    print("\n" + "="*80 + "\n")

if __name__ == "__main__":
    eval_distribution_scale()
