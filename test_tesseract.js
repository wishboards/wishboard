import Tesseract from 'tesseract.js';

Tesseract.recognize('dummy.png', 'eng', { logger: m => console.log(m) }).then(({ data: { text } }) => {
  console.log(text);
});
