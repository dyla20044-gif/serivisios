// Este es m3u8Extractor.js
const { exec } = require('child_process');

/**
 * Llama a yt-dlp en la línea de comandos para extraer un M3U8/MP4.
 * @param {string} targetUrl - La URL de la página (ej. vimeos.net/embed-...)
 * @returns {Promise<string>} - Una promesa que resuelve al enlace M3U8/MP4 directo.
 */
function extractWithYtDlp(targetUrl) {
    console.log(`[yt-dlp] Extrayendo de: ${targetUrl}`);
    
    // Comando:
    // -g: "get-url" (obtener solo el enlace)
    // --no-warnings: No imprimir advertencias
    // --socket-timeout 10: Rendirse si la conexión tarda más de 10 seg.
    // -f "best[ext=mp4]/best": Pedir el mejor MP4 o, en su defecto, el mejor stream (que será M3U8)
    const comando = `yt-dlp -g --no-warnings --socket-timeout 10 -f "best[ext=mp4]/best" "${targetUrl}"`;

    return new Promise((resolve, reject) => {
        // exec ejecuta el comando en la terminal del servidor
        exec(comando, (error, stdout, stderr) => {
            if (error) {
                console.error(`[yt-dlp] Error al ejecutar: ${stderr}`);
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
