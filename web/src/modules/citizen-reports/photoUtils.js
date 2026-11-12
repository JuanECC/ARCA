export async function compressPhoto(file) {
  if (!file) return null;
  if (!file.type.startsWith('image/')) throw new Error('Selecciona un archivo de imagen.');
  if (file.size > 12 * 1024 * 1024) throw new Error('La foto original no debe superar 12 MB.');
  const objectURL = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectURL;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('No se pudo leer la fotografía.');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Este navegador no permite comprimir fotografías.');
    for (const maxSide of [900, 720, 560, 420]) {
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.72, 0.55, 0.4, 0.28]) {
        const dataURL = canvas.toDataURL('image/webp', quality);
        // Algunos navegadores no soportan WebP: canvas devuelve PNG.
        if (!dataURL.startsWith('data:image/webp;base64,')) continue;
        const base64Length = dataURL.length - dataURL.indexOf(',') - 1;
        const estimatedBytes = Math.ceil(base64Length * 3 / 4);
        if (estimatedBytes <= 120 * 1024) return dataURL;
      }
    }
    throw new Error('La imagen es demasiado compleja para comprimirla. Prueba con otra fotografía.');
  } finally {
    URL.revokeObjectURL(objectURL);
  }
}

