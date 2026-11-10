// Is this upload actually a voice note?
//
// The browser's stated content type is whatever the sender says it is, so the
// transcribe route reads the first bytes instead, the same way the tellme
// upload route checks images. Only the containers a browser recorder really
// produces are let through; everything else is a 415 before any model sees it.

export function sniffAudio(bytes) {
  if (!bytes || bytes.length < 12) return null;
  const at = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) {
      if (bytes[offset + i] !== text.charCodeAt(i)) return false;
    }
    return true;
  };
  // EBML header: webm from Chrome, Firefox and Android.
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  // ISO base media: mp4/m4a from Safari and iPhones.
  if (at(4, 'ftyp')) return 'mp4';
  if (at(0, 'OggS')) return 'ogg';
  if (at(0, 'RIFF') && at(8, 'WAVE')) return 'wav';
  return null;
}
