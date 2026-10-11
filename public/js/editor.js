const status = document.getElementById('editorStatus');
function report(message) { if (status) status.textContent = message; }
const imageFields = document.getElementById('imageFields');
let fieldId = 1;
function addImageField(value = '') {
    if (!imageFields || imageFields.children.length >= 8) { report('You can use up to eight images.'); return; }
    const group = document.createElement('div'); group.className = 'form-group image-field';
    const input = document.createElement('input'); input.id = `imageUrl${++fieldId}`; input.type = 'url'; input.name = 'imageUrls[]'; input.required = true; input.value = value; input.placeholder = 'https://example.com/product.jpg';
    const label = document.createElement('label'); label.htmlFor = input.id; label.textContent = `Image ${imageFields.children.length + 1}`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button remove-btn'; remove.textContent = 'Remove'; remove.addEventListener('click', () => group.remove());
    group.append(label, input, remove); imageFields.append(group);
}
document.getElementById('addImageField')?.addEventListener('click', () => addImageField());
document.getElementById('fetchImages')?.addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true; report('Finding product images…');
    try {
        const response = await fetch(`/fetch_images?sourceUrl=${encodeURIComponent(document.getElementById('sourceUrl').value)}`);
        if (response.redirected) { window.location.href = response.url; return; }
        const data = await response.json(); if (!response.ok || data.error) throw new Error(data.error || 'Images could not be fetched.');
        if (!data.imageUrls.length) throw new Error('No images found. Paste image URLs directly.');
        imageFields.replaceChildren(); data.imageUrls.forEach(url => addImageField(url)); report(`${data.imageUrls.length} images found. Remove any unrelated photos.`);
    } catch (error) { report(error.message); } finally { button.disabled = false; }
});
for (const id of ['imageForm', 'videoForm']) {
    document.getElementById(id)?.addEventListener('submit', event => {
        event.target.querySelector('button[type="submit"], button:not([type])')?.setAttribute('disabled', '');
        report('Creating your draft. This may take a moment…');
    });
}
document.getElementById('copyDescription')?.addEventListener('click', async () => {
    const editor = document.getElementById('description');
    try { await navigator.clipboard.writeText(editor.value); report('Description copied.'); }
    catch { editor.focus(); editor.select(); report('Select and copy the text using your keyboard.'); }
});
document.getElementById('translateForm')?.addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button');
    document.getElementById('translationText').value = document.getElementById('description').value;
    button.disabled = true; report('Translating your draft…');
    try {
        const response = await fetch(form.action, { method: 'POST', body: new URLSearchParams(new FormData(form)) });
        if (response.redirected) { window.location.href = response.url; return; }
        const text = await response.text(); if (!response.ok) throw new Error('Translation failed. Check your session and credit balance.');
        document.getElementById('description').value = text; report('Translation ready.');
    } catch (error) { report(error.message); } finally { button.disabled = false; }
});
