let startX, startY, currentX, currentY;
let drawing = false;
let hasSelection = false;
let thickness = 5;
let currentImageId = null;
let baseFFTImage = null;

const fftCanvas = document.getElementById('fftCanvas');
const shapeSelect = document.getElementById('shape');

// Update thickness value and live preview
document.getElementById('thickness').addEventListener('input', (e) => {
    thickness = parseInt(e.target.value);
    document.getElementById('thicknessValue').innerText = thickness;
    if (drawing) {
        drawPreviewShape(currentX, currentY);
    }
});

// Handle image upload
document.getElementById('uploadForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    fetch('/upload', { method: 'POST', body: formData })
        .then(r => r.json())
        .then(data => {
            currentImageId = data.id;
            document.getElementById('originalImage').src = data.original + '?t=' + Date.now();
            loadFFTImage(data.fft + '?t=' + Date.now());
            document.getElementById('ifftImage').src = data.ifft + '?t=' + Date.now();
            hasSelection = false;
        }).catch(err => {
            console.error(err);
            alert('Upload failed');
        });
});

// Reset mask
document.getElementById('resetMask').addEventListener('click', () => {
    if (!currentImageId) return;
    fetch('/reset_mask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentImageId })
    }).then(() => updateImages());
});

// Apply shape button
document.getElementById('applyBtn').addEventListener('click', () => {
    if (!currentImageId) { alert('Upload first'); return; }
    if (!hasSelection) { alert('Draw a shape first'); return; }
    applyShape(startX, startY, currentX, currentY);
    hasSelection = false;
});

// Mouse events for drawing shapes
fftCanvas.addEventListener('mousedown', (e) => {
    if (!baseFFTImage) return;
    const rect = fftCanvas.getBoundingClientRect();
    // store canvas internal coords
    startX = Math.round((e.clientX - rect.left) * (fftCanvas.width / rect.width));
    startY = Math.round((e.clientY - rect.top)  * (fftCanvas.height / rect.height));
    drawing = true;
    hasSelection = false;
});

fftCanvas.addEventListener('mousemove', (e) => {
    if (!drawing) return;
    const rect = fftCanvas.getBoundingClientRect();
    currentX = Math.round((e.clientX - rect.left) * (fftCanvas.width / rect.width));
    currentY = Math.round((e.clientY - rect.top)  * (fftCanvas.height / rect.height));
    drawPreviewShape(currentX, currentY);
});

fftCanvas.addEventListener('mouseup', () => {
    if (!drawing) return;
    drawing = false;
    hasSelection = true;
});

function drawPreviewShape(x, y) {
    const ctx = fftCanvas.getContext('2d');
    ctx.clearRect(0, 0, fftCanvas.width, fftCanvas.height);
    ctx.drawImage(baseFFTImage, 0, 0);

    const w = x - startX;
    const h = y - startY;

    // Convert FFT thickness to preview thickness
    const scaleX = fftCanvas.width / baseFFTImage.width;
    const scaleY = fftCanvas.height / baseFFTImage.height;
    const previewThicknessX = Math.max(1, thickness * scaleX);
    const previewThicknessY = Math.max(1, thickness * scaleY);

    ctx.strokeStyle = 'red';
    ctx.lineWidth = (shapeSelect.value.includes('hollow') || shapeSelect.value === 'ring')
        ? Math.max(previewThicknessX, previewThicknessY)
        : 2;
    ctx.fillStyle = 'rgba(255,0,0,0.3)';

    const centerX = startX + w / 2;
    const centerY = startY + h / 2;
    const radiusX = Math.abs(w / 2);
    const radiusY = Math.abs(h / 2);

    switch (shapeSelect.value) {
        case 'rect':
            ctx.fillRect(startX, startY, w, h);
            break;
        case 'hollow_rect':
            ctx.strokeRect(startX, startY, w, h);
            break;
        case 'circle':
            ctx.beginPath();
            ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
            ctx.fill();
            break;
        case 'ring':
            // Outer ellipse path
            ctx.beginPath();
            ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);

            // Inner ellipse path (subtract thickness)
            ctx.moveTo(centerX + radiusX - previewThicknessX, centerY);
            ctx.ellipse(centerX, centerY,
                        Math.max(0, radiusX - previewThicknessX),
                        Math.max(0, radiusY - previewThicknessY),
                        0, 0, Math.PI * 2, true);

            ctx.closePath();
            ctx.fill();
            break;
    }
}




function applyShape(x0, y0, x1, y1) {
    if (!currentImageId || !baseFFTImage) return;

    // canvas internal pixel dimensions
    const canvasW = fftCanvas.width;
    const canvasH = fftCanvas.height;
    // FFT image pixel dimensions (what server expects when it multiplies normalized coords by w/h)
    const imgW = baseFFTImage.width;
    const imgH = baseFFTImage.height;

    // normalize coordinates into [0,1] based on canvas internal coords
    const nx0 = x0 / canvasW;
    const ny0 = y0 / canvasH;
    const nx1 = x1 / canvasW;
    const ny1 = y1 / canvasH;

    // convert thickness (slider value given in canvas pixels) into image pixels
    // thickness slider is in canvas pixels (because preview draws with that width)
    // scale thickness to image pixel units
    const scaleX = imgW / canvasW;
    const scaleY = imgH / canvasH;
    // use the average scaling to be safer if non-square
    const scale = (scaleX + scaleY) / 2.0;
    const thicknessInImg = Math.max(1, Math.round(thickness * scale));

    const payload = {
        id: currentImageId,
        shape: shapeSelect.value,
        x0: nx0,
        y0: ny0,
        x1: nx1,
        y1: ny1,
        thickness: thicknessInImg
    };

    fetch('/apply_shape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then(() => updateImages())
      .catch(err => {
         console.error('apply failed', err);
         alert('Apply failed');
      });
}

function loadFFTImage(src) {
    baseFFTImage = new Image();
    baseFFTImage.onload = () => {
        // set internal canvas resolution to match the actual FFT image pixels
        fftCanvas.width = baseFFTImage.width;
        fftCanvas.height = baseFFTImage.height;
        fftCanvas.getContext('2d').drawImage(baseFFTImage, 0, 0);
    };
    baseFFTImage.src = src;
}

function updateImages() {
    if (!currentImageId) return;
    fetch(`/get_images/${currentImageId}`)
        .then(r => r.json())
        .then(data => {
            document.getElementById('originalImage').src = data.original + '?t=' + Date.now();
            loadFFTImage(data.fft + '?t=' + Date.now());
            document.getElementById('ifftImage').src = data.ifft + '?t=' + Date.now();
        }).catch(err => {
            console.error('updateImages failed', err);
        });
}

