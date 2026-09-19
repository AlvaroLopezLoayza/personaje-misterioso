// Avatares 8-bit genéricos (unisex, sin rostro definido por género).
const AVATARS = [
  { id: 'rojo', body: '#FF4136', head: '#FF9A93' },
  { id: 'azul', body: '#00A8F0', head: '#8FE3FF' },
  { id: 'verde', body: '#00FF66', head: '#B6FFD1' },
  { id: 'amarillo', body: '#FFD700', head: '#FFF0A6' },
  { id: 'morado', body: '#B14BFF', head: '#E0B6FF' },
  { id: 'naranja', body: '#FF8C00', head: '#FFCD8F' },
  { id: 'cyan', body: '#00F0FF', head: '#B4FBFF' },
  { id: 'rosa', body: '#FF5FD2', head: '#FFC2EF' }
];

// H = cabeza, B = cuerpo, W = ojo, D = contorno/pies, . = vacío
const SPRITE = [
  '..DDDD..',
  '.DHHHHD.',
  '.DHWHWD.',
  '.DHHHHD.',
  '..DHHD..',
  '.BBBBBB.',
  'BBBBBBBB',
  'B.BBBB.B',
  '..DD.DD.'
];

function avatarSVG(id, cls) {
  const a = AVATARS.find(x => x.id === id) || AVATARS[0];
  const paint = { H: a.head, B: a.body, W: '#FFFFFF', D: '#120018' };
  let rects = '';
  SPRITE.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = paint[row[x]];
      if (c) rects += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + c + '"/>';
    }
  });
  return '<svg class="' + (cls || 'monito') + '" viewBox="0 0 8 9" shape-rendering="crispEdges">' + rects + '</svg>';
}

// Reescribe un bloque sólo si su contenido cambió. El estado llega 2 veces por
// segundo: sin esta guarda las animaciones CSS se reinician en cada tick.
function setHTML(el, key, html) {
  if (el.dataset.k === key) return false;
  el.dataset.k = key;
  el.innerHTML = html;
  return true;
}

// Decodifica la foto respetando la orientación EXIF. Sin esto, las fotos
// verticales de Android salen acostadas: drawImage ignora el EXIF, pero
// createImageBitmap con imageOrientation sí lo aplica. El <img> queda de
// respaldo para navegadores viejos (iOS < 15), donde Safari ya orienta solo.
function decodeImage(file) {
  if (window.createImageBitmap) {
    return createImageBitmap(file, { imageOrientation: 'from-image' })
      .catch(() => decodeViaImg(file));
  }
  return decodeViaImg(file);
}

function decodeViaImg(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('formato no soportado')); };
    img.src = url;
  });
}

// Comprime la foto en el navegador antes de enviarla (máx 800px, JPEG 0.6).
async function compressImage(file, maxW, quality) {
  maxW = maxW || 800; quality = quality || 0.6;
  const src = await decodeImage(file);
  const w = src.width || src.naturalWidth;
  const h = src.height || src.naturalHeight;
  if (!w || !h) throw new Error('imagen vacía');
  const scale = Math.min(1, maxW / w);
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  if (src.close) src.close();   // libera el bitmap en Android de gama baja
  return c.toDataURL('image/jpeg', quality);
}
