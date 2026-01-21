const axios = require('axios');
const NodeCache = require('node-cache');

// Caché para aguantar tráfico masivo (1 hora)
const bridgeCache = new NodeCache({ stdTTL: 3600 });

module.exports = function(app) {
    const TMDB_API_KEY = process.env.TMDB_API_KEY;
    const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.salacine.app"; 

    async function getTmdbData(id, type) {
        const cacheKey = `bridge_v3_${type}_${id}`;
        const cached = bridgeCache.get(cacheKey);
        if (cached) return cached;

        try {
            const url = `https://api.themoviedb.org/3/${type}/${id}?api_key=${TMDB_API_KEY}&language=es-MX`;
            const response = await axios.get(url);
            bridgeCache.set(cacheKey, response.data);
            return response.data;
        } catch (error) {
            console.error(`[Bridge] Error TMDB ${id}:`, error.message);
            return null;
        }
    }

    app.get('/view/:type/:id', async (req, res) => {
        const { type, id } = req.params;
        
        if (type !== 'movie' && type !== 'tv') return res.status(404).send('Tipo inválido');

        const data = await getTmdbData(id, type);
        if (!data) return res.status(404).send('Contenido no encontrado');

        // Datos visuales
        const title = data.title || data.name;
        const backdrop = data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : 'https://placehold.co/1280x720/000000/FFFFFF?text=Sala+Cine';
        const poster = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : 'https://placehold.co/500x750?text=No+Poster';
        const year = (data.release_date || data.first_air_date || '').substring(0, 4);
        const rating = data.vote_average ? data.vote_average.toFixed(1) : 'N/A';
        
        // ESTRATEGIA DE APERTURA DIRECTA (Android Intent)
        // Esto le dice a Android: "Abre la app Sala Cine en la pantalla de detalles de este ID".
        // Si no la tienes instalada, ve a la Play Store (S.browser_fallback_url).
        // Usamos el esquema exacto que tu app espera: salacine://details?id=...
        const androidIntent = `intent://details?id=${id}#Intent;scheme=salacine;package=com.salacine.app;S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`;

        const html = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <title>Abriendo ${title}...</title>
            
            <meta property="og:title" content="▶️ Ver ${title} (${year})">
            <meta property="og:description" content="Toca para ver en Sala Cine App">
            <meta property="og:image" content="${backdrop}">
            <meta name="theme-color" content="#0a0a0a">

            <style>
                :root { --primary: #E50914; --dark: #0a0a0a; }
                * { box-sizing: border-box; }
                body { margin: 0; font-family: -apple-system, sans-serif; background: var(--dark); color: white; overflow: hidden; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; }
                
                /* Fondo difuminado */
                .bg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: url('${backdrop}') center/cover; filter: blur(20px) brightness(0.4); z-index: -1; transform: scale(1.1); }
                
                /* Tarjeta Central */
                .card { text-align: center; padding: 30px; max-width: 400px; width: 90%; animation: fadeUp 0.8s ease-out; }
                
                .poster { 
                    width: 140px; height: 210px; border-radius: 12px; 
                    box-shadow: 0 15px 30px rgba(0,0,0,0.5); 
                    margin: 0 auto 20px auto; 
                    background: url('${poster}') center/cover;
                    border: 2px solid rgba(255,255,255,0.1);
                }

                h1 { margin: 0 0 10px 0; font-size: 1.5rem; font-weight: 800; text-shadow: 0 2px 10px rgba(0,0,0,0.5); }
                p { color: #ccc; font-size: 0.9rem; margin-bottom: 25px; }

                .loader { margin: 20px auto; width: 30px; height: 30px; border: 3px solid rgba(255,255,255,0.3); border-radius: 50%; border-top-color: var(--primary); animation: spin 1s ease-in-out infinite; }

                .btn { 
                    background: var(--primary); color: white; border: none; padding: 14px 30px; 
                    border-radius: 50px; font-weight: bold; font-size: 1rem; cursor: pointer; 
                    text-decoration: none; display: inline-block; box-shadow: 0 4px 15px rgba(229, 9, 20, 0.4);
                }

                @keyframes spin { to { transform: rotate(360deg); } }
                @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
            </style>
        </head>
        <body>
            <div class="bg"></div>

            <div class="card">
                <div class="poster"></div>
                <h1>${title}</h1>
                <p>Abriendo aplicación...</p>
                
                <div class="loader"></div>

                <a id="manualLink" href="${androidIntent}" class="btn">
                    Abrir en App
                </a>
            </div>

            <script>
                // AUTOMATIZACIÓN
                window.onload = function() {
                    // Intentar abrir inmediatamente usando el Intent de Android
                    window.location.href = "${androidIntent}";

                    // Fallback para navegadores que bloquean redirecciones automáticas
                    // Si en 2 segundos no ha pasado nada, cambiamos el texto
                    setTimeout(() => {
                        document.querySelector('p').innerText = "¿No se abrió? Toca el botón:";
                        document.querySelector('.loader').style.display = 'none';
                    }, 2500);
                };
            </script>
        </body>
        </html>
        `;

        res.send(html);
    });
};
