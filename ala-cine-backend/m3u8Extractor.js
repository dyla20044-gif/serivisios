const { chromium } = require('playwright');
const axios = require('axios'); // Lo usaremos para verificar si el m3u8 tiene restricciones

/**
 * Función que toma una URL de un player embed (como filemoon.sx) y
 * devuelve la URL m3u8 real junto con los encabezados necesarios.
 * @param {string} embedUrl - URL del player embed.
 * @returns {Promise<{m3u8Url: string, headers: object}|null>} La URL m3u8 y headers, o null.
 */
async function extractM3U8FromEmbed(embedUrl) {
    let browser;
    let m3u8Url = null;
    let headers = {};

    try {
        // 1. Iniciar un navegador Chromium en modo sin cabeza (headless: true)
        browser = await chromium.launch({ headless: true }); 
        const context = await browser.newContext({
            // Puedes establecer un User-Agent común para simular un navegador móvil o de escritorio
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36'
        });
        const page = await context.newPage();

        // 2. Interceptar las peticiones de red
        // Usamos page.route para interceptar y no solo escuchar, lo que da más control.
        await page.route(/.m3u8$/, async (route) => {
            const request = route.request();
            const url = request.url();
            
            // Si ya encontramos un m3u8 principal, lo guardamos y extraemos headers.
            if (!m3u8Url) {
                m3u8Url = url;
                // Guardamos los encabezados de la petición del m3u8, 
                // especialmente el 'Referer', que puede ser crucial para la reproducción.
                headers = request.headers();
                
                // Si encontramos el m3u8, abortamos las demás peticiones y cerramos la página
                route.abort(); 
            } else {
                // Si ya encontramos el principal, dejamos pasar los demás m3u8
                route.continue();
            }
        });

        // 3. Navegar y esperar la carga (el JS se ejecuta aquí)
        await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // Damos un tiempo extra para que se complete la solicitud asíncrona de video
        // (A veces el m3u8 se solicita un segundo después del DOMContentLoaded)
        await page.waitForTimeout(5000); 

        // Cierra el navegador
        await browser.close(); 

        if (m3u8Url) {
            // El 'Referer' es el encabezado más importante
            const referer = headers['referer'] || embedUrl;
            
            return { 
                m3u8Url: m3u8Url, 
                // Devolvemos solo los encabezados críticos.
                headers: { 
                    'Referer': referer, 
                    'User-Agent': headers['user-agent'] || 'SalaCine-Custom-Caster' 
                } 
            };
        }
        
        return null;

    } catch (error) {
        console.error("❌ Error en extractM3U8FromEmbed:", error.message);
        if (browser) await browser.close();
        // Devolvemos null en caso de error
        return null;
    }
}

// Para usar axios para verificar la respuesta del m3u8 (opcional)
async function verifyM3U8Url(url, headers) {
    try {
        const response = await axios.head(url, { headers, timeout: 5000 });
        return response.status === 200;
    } catch (e) {
        return false;
    }
}

module.exports = { extractM3U8FromEmbed, verifyM3U8Url };
