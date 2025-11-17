// Este es m3u8Extractor.js (V3 - El Definitivo)
const { exec } = require('child_process');

/**
 * Llama a yt-dlp en la línea de comandos para extraer un M3U8/MP4.
 * @param {string} targetUrl - La URL de la página (ej. vimeos.net/embed-...)
 * @returns {Promise<string>} - Una promesa que resuelve al enlace M3U8/MP4 directo.
 */
function extractWithYtDlp(targetUrl) {
    console.log(`[yt-dlp] Extrayendo de: ${targetUrl}`);
    
    // --- MODIFICACIÓN V3 ---
    // Llamamos a yt-dlp como un MÓDULO de Python.
    // Esto evita CUALQUIER problema con el PATH del sistema.
    // El comando 'python3 -m yt_dlp' es el equivalente a 'yt-dlp'.
    const comando = `python3 -m yt_dlp -g --no-warnings --socket-timeout 10 -f "best[ext=mp4]/best" "${targetUrl}"`;
    // --- FIN MODIFICACIÓN V3 ---

    return new Promise((resolve, reject) => {
        exec(comando, (error, stdout, stderr) => {
            if (error) {
                // Si esto falla, ya no será "not found".
                // Será un error real de Python o de yt-dlp.
                console.error(`[yt-dlp] Error al ejecutar (python3 -m yt_dlp): ${stderr}`);
                reject(new Error(stderr || 'Error desconocido de yt-dlp'));
                return;
            }

            if (stderr) {
                console.warn(`[yt-dlp] Advertencia: ${stderr}`);
            }

            // stdout es la salida de la consola (el enlace)
            const m3u8Enlace = stdout.trim();

            // Verificamos que sea un enlace válido
            if (m3u8Enlace.startsWith('http')) {
                 console.log(`[yt-dlp] Enlace encontrado: ${m3u8Enlace}`);
                 resolve(m3u8Enlace);
            } else {
                 console.error(`[yt-dlp] La salida no fue un enlace válido: ${stdout}`);
                 reject(new Error('No se encontró un enlace M3U8/MP4 válido.'));
            }
        });
    });
}

// Exportamos la función para que server.js pueda usarla
module.exports = { extractWithYtDlp };
