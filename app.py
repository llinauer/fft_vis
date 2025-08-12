import os
import uuid
import io
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from flask import Flask, render_template, request, jsonify, send_file
from PIL import Image

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Store image data in memory (id -> dict)
images = {}

def compute_fft(img_array):
    """Compute FFT and return shifted spectrum and magnitude."""
    fft = np.fft.fft2(img_array, axes=(0, 1)) if img_array.ndim == 3 else np.fft.fft2(img_array)
    fft_shifted = np.fft.fftshift(fft)
    magnitude = np.log1p(np.abs(fft_shifted))
    return fft_shifted, magnitude

def save_spectrum(magnitude):
    """Convert FFT magnitude to PNG in memory."""
    fig, ax = plt.subplots(figsize=(5, 5))
    if magnitude.ndim == 3:
        gray = np.mean(magnitude, axis=2)
        ax.imshow(gray, cmap='gray')
    else:
        ax.imshow(magnitude, cmap='gray')
    ax.axis('off')
    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight', pad_inches=0)
    plt.close(fig)
    buf.seek(0)
    return buf

def save_image(img_array):
    """Save image array as PNG in memory."""
    fig, ax = plt.subplots(figsize=(5, 5))
    if img_array.ndim == 2:
        ax.imshow(np.clip(img_array, 0, 255), cmap='gray')
    else:
        ax.imshow(np.clip(img_array, 0, 255).astype(np.uint8))
    ax.axis('off')
    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight', pad_inches=0)
    plt.close(fig)
    buf.seek(0)
    return buf

def apply_shape_to_mask(mask, shape, x0, y0, x1, y1, thickness):
    """Modify the mask array based on shape type."""
    h, w = mask.shape[:2]
    y0, y1 = sorted((int(y0), int(y1)))
    x0, x1 = sorted((int(x0), int(x1)))

    yy, xx = np.ogrid[:h, :w]

    if shape == 'rect':
        mask[y0:y1, x0:x1] = 0
    elif shape == 'hollow_rect':
        mask[y0:y0+thickness, x0:x1] = 0
        mask[y1-thickness:y1, x0:x1] = 0
        mask[y0:y1, x0:x0+thickness] = 0
        mask[y0:y1, x1-thickness:x1] = 0
    elif shape == 'circle':
        cy, cx = (y0 + y1) / 2, (x0 + x1) / 2
        ry, rx = abs(y1 - y0) / 2, abs(x1 - x0) / 2
        ellipse = ((yy - cy) / ry) ** 2 + ((xx - cx) / rx) ** 2 <= 1
        mask[ellipse] = 0
    elif shape == 'ring':
        cy, cx = (y0 + y1) / 2, (x0 + x1) / 2
        ry, rx = abs(y1 - y0) / 2, abs(x1 - x0) / 2
        dist = ((yy - cy) / ry) ** 2 + ((xx - cx) / rx) ** 2
        outer = dist <= 1
        inner = ((yy - cy) / (ry - thickness)) ** 2 + ((xx - cx) / (rx - thickness)) ** 2 <= 1
        mask[outer & ~inner] = 0

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload():
    file = request.files['file']
    if not file:
        return jsonify({'error': 'No file uploaded'}), 400

    img = Image.open(file.stream).convert('RGB')
    img_array = np.array(img)

    fft_shifted, magnitude = compute_fft(img_array)
    mask = np.ones(fft_shifted.shape, dtype=bool)

    img_id = str(uuid.uuid4())
    images[img_id] = {
        'original': img_array,
        'fft_shifted': fft_shifted,
        'mask': mask
    }

    buf_fft = save_spectrum(magnitude)
    buf_orig = save_image(img_array)
    buf_ifft = save_image(img_array)  # initially identical

    return jsonify({
        'id': img_id,
        'original': f"/image/{img_id}/original",
        'fft': f"/image/{img_id}/fft",
        'ifft': f"/image/{img_id}/ifft"
    })

@app.route('/image/<img_id>/<img_type>')
def get_image(img_id, img_type):
    if img_id not in images:
        return "Not found", 404

    if img_type == 'original':
        return send_file(save_image(images[img_id]['original']), mimetype='image/png')
    elif img_type == 'fft':
        magnitude = np.log1p(np.abs(images[img_id]['fft_shifted'] * images[img_id]['mask']))
        return send_file(save_spectrum(magnitude), mimetype='image/png')
    elif img_type == 'ifft':
        modified_fft = images[img_id]['fft_shifted'] * images[img_id]['mask']
        ifft_img = np.fft.ifft2(np.fft.ifftshift(modified_fft), axes=(0, 1))
        ifft_img = np.real(ifft_img)
        if ifft_img.ndim == 3:
            ifft_img = np.clip(ifft_img, 0, 255).astype(np.uint8)
        else:
            ifft_img = np.clip(ifft_img, 0, 255)
        return send_file(save_image(ifft_img), mimetype='image/png')
    return "Invalid type", 400


@app.route('/apply_shape', methods=['POST'])
def apply_shape():
    data = request.get_json()
    img_id = data.get('id')
    if img_id not in images:
        return jsonify({'error': 'Invalid image ID'}), 400

    shape = data['shape']
    thickness = int(data.get('thickness', 5))

    mask = images[img_id]['mask']
    h, w = mask.shape[:2]

    # Convert normalized coords to actual pixel coords
    x0 = int(data['x0'] * w)
    y0 = int(data['y0'] * h)
    x1 = int(data['x1'] * w)
    y1 = int(data['y1'] * h)

    if mask.ndim == 3:
        for c in range(mask.shape[2]):
            apply_shape_to_mask(mask[:, :, c], shape, x0, y0, x1, y1, thickness)
    else:
        apply_shape_to_mask(mask, shape, x0, y0, x1, y1, thickness)

    return jsonify(success=True)


@app.route('/reset_mask', methods=['POST'])
def reset_mask():
    data = request.get_json()
    img_id = data.get('id')
    if img_id not in images:
        return jsonify({'error': 'Invalid image ID'}), 400

    mask = np.ones(images[img_id]['fft_shifted'].shape, dtype=bool)
    images[img_id]['mask'] = mask
    return jsonify(success=True)

@app.route('/get_images/<img_id>')
def get_images_route(img_id):
    if img_id not in images:
        return jsonify({'error': 'Invalid image ID'}), 400
    return jsonify({
        'original': f"/image/{img_id}/original",
        'fft': f"/image/{img_id}/fft",
        'ifft': f"/image/{img_id}/ifft"
    })

if __name__ == '__main__':
    app.run(debug=True)

