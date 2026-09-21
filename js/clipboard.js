/*
 * clipboard.js – Text in die Zwischenablage kopieren.
 * Erst die moderne API, sonst der alte Weg über ein verstecktes Textfeld (z. B. ohne https).
 */

/** Kopiert Text. @returns {Promise<boolean>} true, wenn es geklappt hat */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) { /* weiter mit dem alten Weg */ }
  return legacyCopy(text);
}

function legacyCopy(text) {
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (err) {
    ok = false;
  }
  field.remove();
  return ok;
}
