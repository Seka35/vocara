import os
import random
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import torchvision.transforms as transforms
import torchvision.models as models

# --- 1. Synthetic Sound Waveform Dataset Generator ---
class SyntheticWaveformDataset(Dataset):
    def __init__(self, num_classes=50, samples_per_class=100, img_size=(128, 128)):
        self.num_classes = num_classes
        self.samples_per_class = samples_per_class
        self.img_size = img_size
        
        # Pre-generate base 64-bin fingerprints for each class
        self.base_fingerprints = []
        for c in range(num_classes):
            # Create distinct synthetic waveform profile (some dynamic, some quiet/short)
            num_peaks = random.randint(1, 6)
            bins = np.zeros(64)
            for _ in range(num_peaks):
                center = random.randint(5, 58)
                width = random.uniform(2, 10)
                height = random.uniform(0.3, 1.0)
                for i in range(64):
                    bins[i] += height * math.exp(-0.5 * ((i - center) / width) ** 2)
            max_val = np.max(bins)
            if max_val > 0:
                bins = bins / max_val
            self.base_fingerprints.append(bins)

    def render_waveform_image(self, bins, augment=True):
        W, H = self.img_size
        
        # 1. Random Background Type (White, Checkered, Dark/Skin Tone, Grayscale Noise)
        bg_type = random.choice(["white", "checkered", "skin_tone", "dark_gray", "noisy"]) if augment else "white"
        
        if bg_type == "white":
            bg_color = 255
            img = Image.new("L", (W, H), color=bg_color)
        elif bg_type == "checkered":
            img = Image.new("L", (W, H), color=240)
            draw_bg = ImageDraw.Draw(img)
            square_s = random.randint(8, 16)
            for y in range(0, H, square_s):
                for x in range(0, W, square_s):
                    if ((x // square_s) + (y // square_s)) % 2 == 0:
                        draw_bg.rectangle([x, y, x + square_s, y + square_s], fill=190)
        elif bg_type == "skin_tone":
            bg_color = random.randint(140, 220) # Simulate skin tone gray level
            img = Image.new("L", (W, H), color=bg_color)
        elif bg_type == "dark_gray":
            bg_color = random.randint(30, 90) # Dark frame or screen bezel
            img = Image.new("L", (W, H), color=bg_color)
        else:
            # Noisy background
            arr = np.random.randint(150, 240, (H, W), dtype=np.uint8)
            img = Image.fromarray(arr)

        draw = ImageDraw.Draw(img)
        cy = H // 2
        
        # Line color: Always dark tattoo ink bars (0..40)
        line_color = random.randint(0, 40)
        
        num_bars = len(bins)
        bar_w = max(1, W // num_bars)
        
        # Draw bars
        for i, val in enumerate(bins):
            x = i * bar_w + bar_w // 2
            bar_h = int(val * (H * 0.4))
            draw.line([(x, cy - bar_h), (x, cy + bar_h)], fill=line_color, width=random.randint(1, 3))
            
        draw.line([(0, cy), (W, cy)], fill=line_color, width=1)

        if augment:
            # 2. Random Scale, Translation & Partial Cropping (Simulate Human Hand Framing)
            if random.random() > 0.3:
                crop_left = random.randint(0, int(W * 0.2))
                crop_right = random.randint(int(W * 0.8), W)
                crop_top = random.randint(0, int(H * 0.15))
                crop_bottom = random.randint(int(H * 0.85), H)
                img = img.crop((crop_left, crop_top, crop_right, crop_bottom))
                img = img.resize((W, H), Image.BICUBIC)

            # 3. Random rotation (-30 to +30 deg)
            angle = random.uniform(-30, 30)
            img = img.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=128)

            # 4. Random blur & noise
            if random.random() > 0.4:
                img = img.filter(ImageFilter.GaussianBlur(radius=random.uniform(0.5, 2.0)))

        return img

    def __len__(self):
        return self.num_classes * self.samples_per_class

    def __getitem__(self, idx):
        class_id = idx // self.samples_per_class
        bins = self.base_fingerprints[class_id]
        
        img = self.render_waveform_image(bins, augment=True)
        tensor = transforms.ToTensor()(img)
        tensor = transforms.Normalize(mean=[0.5], std=[0.5])(tensor)
        
        return tensor, class_id

# --- 2. Lightweight Embedding Network (ResNet18 / MobileNet) ---
class VocaraEmbeddingNet(nn.Module):
    def __init__(self, embed_dim=128):
        super(VocaraEmbeddingNet, self).__init__()
        self.backbone = models.resnet18(weights=None)
        # Adapt single grayscale input channel
        self.backbone.conv1 = nn.Conv2d(1, 64, kernel_size=7, stride=2, padding=3, bias=False)
        in_features = self.backbone.fc.in_features
        self.backbone.fc = nn.Sequential(
            nn.Linear(in_features, 256),
            nn.BatchNorm1d(256),
            nn.ReLU(),
            nn.Linear(256, embed_dim)
        )

    def forward(self, x):
        x = self.backbone(x)
        # L2 Normalize embeddings so inner product equals Cosine Similarity
        x = nn.functional.normalize(x, p=2, dim=1)
        return x

# --- 3. Classification-Guided Metric Loss (Guarantees Class Separation + Zero Collapse) ---
def train_model(epochs=15, batch_size=64, embed_dim=128):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"🚀 Training Vocara AI Robust Metric Model on Device: {device}")
    
    num_classes = 80
    dataset = SyntheticWaveformDataset(num_classes=num_classes, samples_per_class=100)
    dataloader = DataLoader(dataset, batch_size=batch_size, shuffle=True, drop_last=True)
    
    model = VocaraEmbeddingNet(embed_dim=embed_dim).to(device)
    classifier = nn.Linear(embed_dim, num_classes).to(device) # Linear class projection head
    
    optimizer = optim.AdamW(list(model.parameters()) + list(classifier.parameters()), lr=1e-3, weight_decay=1e-4)
    ce_loss = nn.CrossEntropyLoss()
    
    model.train()
    for epoch in range(epochs):
        total_loss = 0.0
        for imgs, labels in dataloader:
            imgs, labels = imgs.to(device), labels.to(device)
            
            optimizer.zero_grad()
            embeds = model(imgs)
            logits = classifier(embeds)
            
            loss = ce_loss(logits, labels)
            
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
            
        avg_loss = total_loss / len(dataloader)
        print(f"Epoch [{epoch+1}/{epochs}] - Classification-Guided Loss: {avg_loss:.4f}")
        
    # Export model to ONNX format
    model.eval()
    dummy_input = torch.randn(1, 1, 128, 128).to(device)
    
    os.makedirs("public/models", exist_ok=True)
    onnx_path = "public/models/vocara_embed.onnx"
    torch.onnx.export(
        model,
        dummy_input,
        onnx_path,
        export_params=True,
        opset_version=12,
        do_constant_folding=True,
        input_names=["input"],
        output_names=["embedding"],
        dynamic_axes={"input": {0: "batch_size"}, "embedding": {0: "batch_size"}}
    )
    print(f"✅ ONNX Model successfully saved to: {onnx_path}")
    return model

if __name__ == "__main__":
    train_model(epochs=15)
