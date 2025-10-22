// Este es el contenido completo y CORREGIDO de GoodStreamServers.js
const axios = require('axios');

/**
 * Intenta obtener el enlace MP4 directo de GodStream.
 * Si falla, devuelve el enlace de inserción (embed) como fallback.
 * @param {string} fileCode - El código del archivo (ej: 'gurkbeec2awc')
 * @param {string} apiKey - Tu clave API de GodStream
 * @returns {string} - Una URL (ya sea .mp4 o el embed de fallback)
 */
async function getGodStreamLink(fileCode, apiKey) {
    const apiUrl = `https://goodstream.one/api/file/direct_link?key=${apiKey}&file_code=${fileCode}`;
    const fallbackEmbedUrl = `https://goodstream.one/embed-${fileCode}.html`;

    if (!apiKey) {
        console.error('Error: Falta la GODSTREAM_API_KEY en getGodStreamLink.');
        return fallbackEmbedUrl; // Fallback si no hay API key
    }

    try {
        const response = await axios.get(apiUrl);
        const responseData = response.data; // El JSON completo

        // <<< [CAMBIO CLAVE] Hacemos el código "bilingüe" >>>
        
        // 1. Busca el objeto 'resultado' (español) O 'result' (inglés)
        const resultObj = responseData?.resultado || responseData?.result;

        // 2. Dentro de ese objeto, busca 'versiones' (español) O 'versions' (inglés)
        const versions = resultObj?.versiones || resultObj?.versions;
        
        // <<< [FIN DEL CAMBIO] >>>

        if (versions && versions.length > 0) {
            // Esta lógica está bien: busca la mejor calidad
            const mp4Url = versions.find(v => v.name === 'h')?.url ||
                           versions.find(v => v.name === 'n')?.url ||
                           versions[0]?.url;

            if (mp4Url) {
                console.log(`✅ [GodStream] MP4 directo entregado para: ${fileCode}`);
                return mp4Url; // ¡Éxito!
            }
        }
        
        // Si no se encontró 'versions' en ninguna de las formas...
        console.warn(`⚠️ [GodStream] API OK pero no se encontraron MP4s para ${fileCode} (JSON: ${JSON.stringify(responseData)}). Usando fallback.`);
        return fallbackEmbedUrl;

    } catch (error) {
        // Si la llamada a la API falla (video no existe, API caída, etc.)
        console.error(`❌ [GodStream] Falló la API para ${fileCode}. Usando fallback. Error: ${error.message}`);
        return fallbackEmbedUrl; // Fallback en caso de error
    }
}

// Exportamos la función para que server.js pueda usarla
module.exports = {
    getGodStreamLink
};
