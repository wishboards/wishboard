const Tesseract = require('tesseract.js');
async function go() {
  try {
    const res = await Tesseract.recognize('dummy.png', 'eng', { logger: m => console.log(m) });
    console.log('Recognized:', res.data.text);
  } catch (err) {
    console.error("Error recognizing:", err);
  }
}
go().catch(console.error);
