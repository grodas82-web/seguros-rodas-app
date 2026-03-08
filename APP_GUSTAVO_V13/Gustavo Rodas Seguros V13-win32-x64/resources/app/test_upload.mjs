import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

(async () => {
    console.log("Iniciando navegador...");
    const browser = await chromium.launch();
    const page = await browser.newPage();

    page.on('console', msg => {
        console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', error => {
        console.error(`[BROWSER UNCAUGHT ERROR] ${error.message}`);
    });

    try {
        console.log("Navegando a la app...");
        await page.goto('http://localhost:5173');

        console.log("Esperando que cargue...");
        await page.waitForTimeout(3000); // Dar tiempo a que cargue la app

        // Crear un PDF falso de prueba
        const pdfPath = path.join(process.cwd(), 'dummy_test.pdf');
        fs.writeFileSync(pdfPath, 'JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmoKPDwvTGVuZ3RoIDMgMCBSL0ZpbHRlci9GbGF0ZURlY29kZT4+CnN0cmVhbQp4nDPQM1Qo5ypUMFAwALJMLdnkoJxMiAAAAA//CgplbmRzdHJlYW0KZW5kb2JqCgozIDAgb2JqCjI5CmVuZG9iagoKMSAwIG9iago8PC9UeXBlL1BhZ2UvTWVkaWFCb3ggWzAgMCAyMDAgMjAwXS9SZXNvdXJjZXM8PC9Gb250PDwvRjEgNCAwIFI+Pj4+L0NvbnRlbnRzIDIgMCBSL1BhcmVudCA1IDAgUj4+CmVuZG9iagoKNCAwIG9iago8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9UaW1lcy1Sb21hbj4+CmVuZG9iagoKNSAwIG9iago8PC9UeXBlL1BhZ2VzL0NvdW50IDEvS2lkc1sxIDAgUl0+PgplbmRvYmoKCjYgMCBvYmoKPDwvVHlwZS9DYXRhbG9nL1BhZ2VzIDUgMCBSPj4KZW5kb2JqCgo3IDAgb2JqCjw8L1Byb2R1Y2VyKGdwZGZtYWtlcikvQ3JlYXRvcihncGRmbWFrZXIpL0NyZWF0aW9uRGF0ZShEOjIwMjMwMTAxMDAwMDAwKzAwJzAwJyk+PgplbmRvYmoKCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDEzNyAwMDAwMCBuIAowMDAwMDAwMDE5IDAwMDAwIG4gCjAwMDAwMDAxMTYgMDAwMDAgbiAKMDAwMDAwMDI1OCAwMDAwMCBuIAowMDAwMDAwMzQ2IDAwMDAwIG4gCjAwMDAwMDA0MDUgMDAwMDAgbiAKMDAwMDAwMDQ1NCAwMDAwMCBuIAp0cmFpbGVyCjw8L1NpemUgOC9Sb290IDYgMCBSL0luZm8gNyAwIFI+PgpzdGFydHhyZWYKNTE5CiUlRU9GCg==', 'base64');

        console.log("Buscando input de archivo y forzando subida...");
        const fileInput = await page.locator('input[type="file"][accept=".pdf"]').first();
        await fileInput.setInputFiles(pdfPath);

        console.log("Esperando 10 segundos para procesamiento...");
        await page.waitForTimeout(10000); // Esperar a que la IA procese el archivo

        console.log("Verificando si apareció un alert...");

        fs.unlinkSync(pdfPath); // Limpiar el archivo dummy

    } catch (e) {
        console.error("Test Error:", e);
    } finally {
        await browser.close();
    }
})();
