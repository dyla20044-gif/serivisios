const axios = require('axios');
const cheerio = require('cheerio'); 

/**
 * Intenta extraer el m3u8 de la página de embed usando peticiones HTTP simples (sin navegador).
 * @param {string} embedUrl - URL del player embed.
 * @returns {Promise<{m3u8Url: string, headers: object}|null>} La URL m3u8 y headers, o null.
 */
async function extractM3U8FromEmbed(embedUrl) {
    try {
        // Establecemos encabezados para simular un navegador y evitar el bloqueo inicial
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36',
            'Referer': embedUrl // Usamos el embedUrl como referer inicial
        };

        // Realiza la petición HTTP simple para obtener el HTML
        const response = await axios.get(embedUrl, { headers: headers, maxRedirects: 5 });
        const $ = cheerio.load(response.data);

        // 1. Buscar directamente por una etiqueta <script> que contenga '.m3u8'
        let m3u8Url = null;
        $('script').each((i, element) => {
            const scriptContent = $(element).html();
            if (scriptContent) {
                // Expresión regular para encontrar cualquier URL que termine en .m3u8
                const match = scriptContent.match(/(https?:\/\/[^\s"']*\.m3u8[^\s"']*(?:[?&][^\s"']*)?)/);
                if (match) {
                    m3u8Url = match[1];
                    return false; // Detiene el .each()
                }
            }
        });

        if (m3u8Url) {
            console.log(`✅ [Cheerio] M3U8 encontrado en el HTML/Script.`);
            // Devolvemos el m3u8 y los headers
            return { 
                m3u8Url: m3u8Url, 
                headers: { 
                    'Referer': embedUrl,
                    'User-Agent': headers['User-Agent']
                } 
            };
        }

        console.warn(`⚠️ [Cheerio] No se encontró la URL m3u8 en el código HTML estático de ${embedUrl}.`);
        return null;

    } catch (error) {
        console.error("❌ Error en extractM3U8FromEmbed (Cheerio):", error.message);
        return null;
    }
}

// Ya no necesitamos verifyM3U8Url aquí
module.exports = { extractM3U8FromEmbed };
